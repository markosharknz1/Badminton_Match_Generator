"""Native app-window launcher for Game Scheduler - packaged as GameScheduler.exe.

Starts the existing Node/Express server (server.js - completely unchanged) as
a hidden background process, opens a real native window via pywebview using
Windows' built-in WebView2 runtime (no bundled Chromium, unlike Electron),
and stops the server the moment that window closes.

This script is built into a single-file .exe via PyInstaller (see
build_exe.bat), so Python/pywebview/pythonnet are bundled inside it - end
users need nothing pre-installed for the launcher itself. The one remaining
external dependency is Node.js, which this script installs automatically via
winget if it's missing (see ensure_node()).

No explicit "save" step is needed before stopping - every mutating API call
already persists to disk immediately (see db/store.js), so there's never any
unsaved state sitting in memory to lose.
"""
import ctypes
import os
import shutil
import subprocess
import sys
import time

PORT = 4000

if getattr(sys, 'frozen', False):
    # Running as the PyInstaller-built exe - __file__ points inside the
    # bundle, not next to server.js, so anchor on the exe's own location.
    BASE_DIR = os.path.dirname(sys.executable)
else:
    BASE_DIR = os.path.dirname(os.path.abspath(__file__))

LOG_DIR = os.path.join(BASE_DIR, 'logs')

CREATE_NO_WINDOW = 0x08000000  # avoids importing subprocess just for this flag pre-Windows-check


def _fatal(message):
    # No console to print to, so this is the one place we surface a real,
    # visible dialog - otherwise a failure just looks like nothing happened.
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(os.path.join(LOG_DIR, 'run.log'), 'a', encoding='utf-8') as f:
        f.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")}  FATAL: {message}\n')
    try:
        ctypes.windll.user32.MessageBoxW(0, message, 'Game Scheduler failed to start', 0x10)
    except Exception:
        pass
    sys.exit(1)


def _info(message):
    try:
        ctypes.windll.user32.MessageBoxW(0, message, 'Game Scheduler - first-time setup', 0x40)
    except Exception:
        pass


def log(message):
    with open(os.path.join(LOG_DIR, 'run.log'), 'a', encoding='utf-8') as f:
        f.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")}  {message}\n')


def refresh_path_from_registry():
    # Re-reads PATH from the registry (System + User) into this already-
    # running process, so a program winget just installed becomes usable
    # immediately instead of requiring the app to be relaunched.
    import winreg

    def read_path(hive, subkey):
        try:
            with winreg.OpenKey(hive, subkey) as key:
                value, _ = winreg.QueryValueEx(key, 'Path')
                return value
        except OSError:
            return ''

    sys_path = read_path(winreg.HKEY_LOCAL_MACHINE, r'SYSTEM\CurrentControlSet\Control\Session Manager\Environment')
    user_path = read_path(winreg.HKEY_CURRENT_USER, 'Environment')
    os.environ['PATH'] = f'{sys_path};{user_path};{os.environ.get("PATH", "")}'


def ensure_node():
    if shutil.which('node'):
        return
    if not shutil.which('winget'):
        _fatal(
            'Node.js is required but was not found, and Windows Package Manager '
            '(winget) is not available to install it automatically.\n\n'
            'Please install Node.js yourself from https://nodejs.org (the LTS '
            'version), then run Game Scheduler again.'
        )
    _info(
        'Setting up Game Scheduler for the first time - installing Node.js.\n\n'
        'This may take a minute. Click OK to start; the app will open '
        'automatically once it is done.'
    )
    log('Installing Node.js via winget...')
    result = subprocess.run(
        ['winget', 'install', '--id', 'OpenJS.NodeJS.LTS', '-e', '--silent',
         '--accept-package-agreements', '--accept-source-agreements'],
        capture_output=True, text=True, creationflags=CREATE_NO_WINDOW,
    )
    if result.returncode != 0:
        log(f'winget install failed: {result.stdout}\n{result.stderr}')
        _fatal(
            'Automatic Node.js install failed.\n\n'
            'Please install it yourself from https://nodejs.org (the LTS '
            'version), then run Game Scheduler again.'
        )
    refresh_path_from_registry()
    if not shutil.which('node'):
        _fatal(
            'Node.js was installed, but this program cannot see it yet.\n\n'
            'Please run Game Scheduler again to continue.'
        )
    log('Node.js installed successfully.')


def ensure_database():
    # node db\init.js is idempotent and additive-only (see db/index.js) -
    # always safe to run, never touches real data.
    result = subprocess.run(
        ['node', 'db\\init.js'], cwd=BASE_DIR, capture_output=True, text=True,
        creationflags=CREATE_NO_WINDOW,
    )
    if result.returncode != 0:
        log(f'db init failed: {result.stdout}\n{result.stderr}')
        _fatal(f'Could not set up the database:\n\n{result.stderr[:500]}')


def ensure_desktop_shortcut():
    # First-run convenience for non-technical users - only makes sense for
    # the packaged exe (dev mode running launcher.py directly has no
    # meaningful shortcut target). Best-effort: any failure here (no
    # win32com, a locked-down Desktop folder, whatever) must never stop the
    # app from launching, same pattern as db/index.js's backupToDocuments().
    if not getattr(sys, 'frozen', False):
        return
    try:
        import win32com.client

        shell = win32com.client.Dispatch('WScript.Shell')
        desktop = shell.SpecialFolders('Desktop')  # respects a OneDrive-redirected Desktop
        shortcut_path = os.path.join(desktop, 'Game Scheduler.lnk')
        if os.path.exists(shortcut_path):
            return  # idempotent - never overwrite one a user moved, renamed, or kept

        exe_path = sys.executable
        custom_icon = os.path.join(BASE_DIR, 'public', 'icons', 'club-icon.ico')
        icon_path = custom_icon if os.path.isfile(custom_icon) else exe_path  # exe carries app_icon.ico as its own resource

        shortcut = shell.CreateShortcut(shortcut_path)
        shortcut.TargetPath = exe_path
        shortcut.WorkingDirectory = BASE_DIR
        shortcut.IconLocation = icon_path
        shortcut.Description = 'Game Scheduler'
        shortcut.save()
        log(f'Created desktop shortcut at {shortcut_path}.')
    except Exception as exc:
        log(f'Could not create a desktop shortcut (non-fatal): {exc}')


def port_open(port):
    import socket
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.3):
            return True
    except OSError:
        return False


def start_server():
    if port_open(PORT):
        log(f'Server already running on port {PORT} - reusing it.')
        return None

    log('Starting server...')
    out_log = open(os.path.join(LOG_DIR, 'server.out.log'), 'w', encoding='utf-8')
    err_log = open(os.path.join(LOG_DIR, 'server.err.log'), 'w', encoding='utf-8')
    process = subprocess.Popen(
        ['node', 'server.js'],
        cwd=BASE_DIR,
        stdout=out_log,
        stderr=err_log,
        creationflags=CREATE_NO_WINDOW,
    )
    with open(os.path.join(LOG_DIR, 'server.pid'), 'w', encoding='utf-8') as f:
        f.write(str(process.pid))

    for _ in range(50):
        if port_open(PORT):
            log(f'Server ready on port {PORT} (pid {process.pid}).')
            return process
        time.sleep(0.3)

    log('Server did not start in time - see server.err.log.')
    if process.poll() is None:
        process.terminate()
    _remove_pid_file()
    _fatal('The server did not start in time.\n\nSee logs\\server.err.log for details.')


def _remove_pid_file():
    pid_file = os.path.join(LOG_DIR, 'server.pid')
    if os.path.exists(pid_file):
        os.remove(pid_file)


def stop_server(process):
    if process is None:
        log('Server was reused from another window - leaving it running.')
        return
    if process.poll() is not None:
        log('Server already stopped (e.g. via Stop.bat) - nothing to do.')
        return
    log(f'Stopping server (pid {process.pid})...')
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
    _remove_pid_file()
    log('Server stopped.')


def main():
    os.makedirs(LOG_DIR, exist_ok=True)
    log('--- GameScheduler.exe launched ---')

    ensure_node()
    ensure_database()
    ensure_desktop_shortcut()

    import webview

    class Api:
        """Exposed to the page as window.pywebview.api.* (see pwa.js). Lets
        the Display nav link open a second CHROMELESS pywebview window
        instead of falling through to WebView2's default handling of
        target="_blank" links, which opens an actual separate Edge browser
        window (with address bar/tabs) - exactly what the native app shell
        is meant to avoid. Display still gets its own window (so it can sit
        on a second monitor/TV while staff keep working in the main
        window), it's just a real app window instead of a browser one.
        """

        def open_display(self):
            webview.create_window(
                'Display - Game Scheduler',
                f'http://localhost:{PORT}/display.html',
                width=1280,
                height=800,
            )

        def save_file(self, filename, data_base64):
            """Native "Save As" dialog + write to disk, for downloads (e.g.
            History's .xlsx export) - see history.js. A plain <a
            href="...">/window.location.href navigation to a
            Content-Disposition:attachment response is a normal-browser
            trick that WebView2 doesn't handle inside a pywebview window
            (same underlying reason open_display exists above), so the page
            fetches the file itself and hands the bytes to this instead.
            """
            import base64
            paths = webview.windows[0].create_file_dialog(
                webview.SAVE_DIALOG, save_filename=filename
            )
            if not paths:
                return {'ok': False, 'cancelled': True}
            path = paths[0]
            with open(path, 'wb') as f:
                f.write(base64.b64decode(data_base64))
            return {'ok': True, 'path': path}

    server_process = start_server()

    def on_closed():
        log('App window closed.')
        stop_server(server_process)

    window = webview.create_window(
        'Game Scheduler',
        f'http://localhost:{PORT}/checkin.html',
        width=1280,
        height=800,
        min_size=(800, 600),
        js_api=Api(),
    )
    window.events.closed += on_closed
    log('Opened app window. Waiting for it to close...')
    webview.start()


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        _fatal(f'{exc}\n\nSee logs\\run.log and logs\\server.err.log for details.')
