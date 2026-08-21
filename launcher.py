"""Native app-window launcher for Game Scheduler.

Replaces the previous Edge --app= + PowerShell approach. Starts the existing
Node/Express server (server.js - completely unchanged) as a hidden background
process, opens a real native window via pywebview using Windows' built-in
WebView2 runtime (no bundled Chromium, unlike Electron), and stops the server
the moment that window closes.

No explicit "save" step is needed before stopping - every mutating API call
already persists to disk immediately (see db/store.js), so there's never any
unsaved state sitting in memory to lose.

Launched via pythonw.exe (the windowless Python interpreter every standard
Windows Python install ships with) from Run.bat - not meant to be run with
the regular python.exe/double-clicked directly, or a console window will
flash briefly.
"""
import os
import sys
import time

PORT = 4000
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_DIR = os.path.join(BASE_DIR, 'logs')


def _fatal(message):
    # Run.bat launches this via pythonw (no console), so an uncaught error
    # would otherwise just vanish - the window never appears and nothing
    # explains why. This is the one place we surface a real, visible dialog.
    os.makedirs(LOG_DIR, exist_ok=True)
    with open(os.path.join(LOG_DIR, 'run.log'), 'a', encoding='utf-8') as f:
        f.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")}  FATAL: {message}\n')
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(0, message, 'Game Scheduler failed to start', 0x10)
    except Exception:
        pass
    sys.exit(1)


try:
    import socket
    import subprocess
    import webview
except Exception as exc:
    _fatal(f'Missing dependency: {exc}\n\nTry double-clicking Run.bat again - it re-installs missing pieces automatically.')


def port_open(port):
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.3):
            return True
    except OSError:
        return False


def log(message):
    with open(os.path.join(LOG_DIR, 'run.log'), 'a', encoding='utf-8') as f:
        f.write(f'{time.strftime("%Y-%m-%d %H:%M:%S")}  {message}\n')


def start_server():
    if port_open(PORT):
        log(f'Server already running on port {PORT} - reusing it.')
        return None

    log('Starting server...')
    out_log = open(os.path.join(LOG_DIR, 'server.out.log'), 'w', encoding='utf-8')
    err_log = open(os.path.join(LOG_DIR, 'server.err.log'), 'w', encoding='utf-8')
    creationflags = subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
    process = subprocess.Popen(
        ['node', 'server.js'],
        cwd=BASE_DIR,
        stdout=out_log,
        stderr=err_log,
        creationflags=creationflags,
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
    sys.exit(1)


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


class Api:
    """Exposed to the page as window.pywebview.api.* (see pwa.js). Lets the
    Display nav link open a second CHROMELESS pywebview window instead of
    falling through to WebView2's default handling of target="_blank" links,
    which opens an actual separate Edge browser window (with address bar/
    tabs) - exactly what the native app shell is meant to avoid. Display
    still gets its own window (so it can sit on a second monitor/TV while
    staff keep working in the main window), it's just a real app window
    instead of a browser one.
    """

    def open_display(self):
        webview.create_window(
            'Display - Game Scheduler',
            f'http://localhost:{PORT}/display.html',
            width=1280,
            height=800,
        )


def main():
    os.makedirs(LOG_DIR, exist_ok=True)
    log('--- Run.bat launched ---')

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
