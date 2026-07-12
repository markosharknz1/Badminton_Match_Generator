// Shared SSE client helper, reused by every screen (check-in, display,
// management). EventSource reconnects automatically on drop - nothing extra
// needed here for that.
function subscribeToEvents(onEvent) {
    const source = new EventSource('/api/events');
    source.onmessage = (e) => {
        try {
            onEvent(JSON.parse(e.data));
        } catch (err) {
            console.error('Bad SSE payload', err);
        }
    };
    return source;
}
