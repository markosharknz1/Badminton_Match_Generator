// Shared across every page: swaps the static favicon for the club's
// uploaded icon (falling back to the bundled default when none has been
// uploaded - see routes/branding.js) and shows a small logo next to the
// club name in the header. Call with whatever club-settings object the
// page already fetched (every page's init() loads one for club_name
// anyway) - no extra request needed.
function applyBranding(clubSettings) {
    const ver = clubSettings?.club_icon_ver || 0;
    const url = `/api/branding/icon?v=${ver}`;

    const iconLink = document.querySelector('link[rel="icon"]');
    if (iconLink) iconLink.href = url;

    let logo = document.getElementById('club-logo');
    const heading = document.getElementById('club-name');
    if (!logo && heading && heading.parentNode) {
        logo = document.createElement('img');
        logo.id = 'club-logo';
        logo.alt = '';
        heading.parentNode.insertBefore(logo, heading);
    }
    if (logo) logo.src = url;
}
