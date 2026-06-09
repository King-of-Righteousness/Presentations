export const state = {
    currentPartIndex: -1,
    sessionVersion: Date.now(),
    SESSION_KEY: 'global_song_presenter_session',
    PREFS_KEY: 'presenter_suite_prefs',
    textSettings: { 
        size: 95, 
        align: 'center', 
        font: 'Inter, sans-serif', 
        color: 'white', 
        bg: 'black', 
        bgImage: null,
        // Added default height for the lyrics cards in the grid
        cardSize: 150 
    },
    isBlackout: true,
    liveSongsState: {},
    driveImagesState: [],
    localMediaState: [],
    audienceWindow: null,
    videoRenderLoop: null,
    videoSyncTimer: null,
    isSeeking: false,
    draggedLiveItem: null,
    canvas: document.getElementById('broadcastCanvas'),
    ctx: null,
    APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbybbQfXQjGFcskLmJsbwC-kwQBdd-TjGxgehTRQYhaclrJqWYb-xavp7PXv1PMKqdRH/exec",
    peerConnection: null
};

// Initialize Canvas context if the element exists
if (state.canvas) {
    state.ctx = state.canvas.getContext('2d');
}

// Preserve global window variables accessed directly by original inline scripts
window.currentSongData = null;
window.isCleanLogout = false;