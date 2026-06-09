import { db } from './firebase-config.js';
import { ref, set, onValue, onDisconnect } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

// Import modules from the 'modules/' directory
import { state } from './modules/state.js';
import { initSmartBroadcasting } from './modules/webrtc.js';
import * as Media from './modules/media.js';
import * as UI from './modules/ui.js';

// --- UI FUNCTION RE-ATTACHMENT ---
window.launchAudience = UI.launchAudience;
window.renderLyricsGrid = UI.renderLyricsGrid;
window.goLive = UI.goLive;
window.toggleBlackout = UI.toggleBlackout;
window.updateFontSize = UI.updateFontSize;
window.updateCardSize = UI.updateCardSize; 
window.setTextAlign = UI.setTextAlign;
window.updateFont = UI.updateFont;
window.setBgColor = UI.setBgColor;
window.uploadBgImage = UI.uploadBgImage;
window.clearBgImage = UI.clearBgImage;
window.loadPrefs = UI.loadPrefs;
window.navigatePart = UI.navigatePart;
window.showNotification = UI.showNotification;
window.acknowledgeMessage = UI.acknowledgeMessage;
window.controlVideo = UI.controlVideo;
window.switchView = UI.switchView;
window.loadLiveSongFromMemory = UI.loadLiveSongFromMemory;
window.loadLiveSongs = UI.loadLiveSongs;

// --- MEDIA FUNCTION RE-ATTACHMENT ---
window.handleLocalMedia = Media.handleLocalMedia;
window.openLocalMediaGallery = Media.openLocalMediaGallery;
window.removeLocalFile = Media.removeLocalFile;
window.fetchDriveImages = Media.fetchDriveImages;
window.addYouTubeLink = Media.addYouTubeLink;
window.filterDriveList = Media.filterDriveList;
window.refreshLibraryDrive = Media.refreshLibraryDrive;
window.publishToLive = Media.publishToLive;
window.unpublishSong = Media.unpublishSong;

/**
 * Updates the global presentation status in Firebase
 */
export function updateStatus(s) { 
    set(ref(db, 'presentation/status'), { state: s, version: state.sessionVersion });
}
window.updateStatus = updateStatus;

// Safety prompt to prevent accidental tab closure
window.onbeforeunload = function(e) {
    if (!window.isCleanLogout) {
        e.preventDefault();
        e.returnValue = ''; 
        return 'Session is active. Are you sure you want to leave?';
    }
};

/**
 * Main session initialization
 */
window.startNewSession = (isRestore = false) => {
    console.log("Session Started");
    const myPresenceRef = ref(db, 'presentation/presence/presenter');
    set(myPresenceRef, true);
    onDisconnect(myPresenceRef).remove();
    
    if (!isRestore) { 
        updateStatus('online');
        state.isBlackout = false; 
        UI.updateBlackoutButton(); 
    }
    
    onDisconnect(ref(db, 'presentation/status')).set({ state: 'online' });
    UI.startTimer();
    UI.initRemoteVideoSync();

    // 1. LISTEN FOR REMOTE MESSAGES
    onValue(ref(db, 'presentation/message'), (s) => {
        const box = document.getElementById('notification-box');
        if(box) {
            if (s.exists()) { 
                document.getElementById('notif-text').innerText = s.val().text; 
                box.style.display = 'flex'; 
            } else { 
                box.style.display = 'none'; 
            }
        }
    });

    // 2. LISTEN FOR DAILY PASSCODE
    onValue(ref(db, 'presentation/access/passcode'), (snap) => {
        const el = document.getElementById('passcode-display');
        if(el) {
            const val = snap.val();
            el.innerText = val && val.code ? `PIN: ${val.code}` : "PIN: --";
        }
    });

// 3. LISTEN FOR LIVE LIBRARY UPDATES (Smart Filter)
    const masterSongsRef = ref(db, 'song_archive');
    onValue(masterSongsRef, (snapshot) => {
        state.liveSongsState = {};
        const libList = document.getElementById('lib-firebase-list');
        if(libList) libList.innerHTML = '';
        
        let liveCount = 0;
        
        if (snapshot.exists()) {
            const allSongs = snapshot.val();
            
            Object.keys(allSongs).forEach(key => {
                const song = allSongs[key];
                
                // ONLY process the song if the live toggle is ON
                if (song.isLive === true) {
                    state.liveSongsState[key] = song; // Add to UI rendering engine
                    liveCount++;
                    
                    if(libList) {
                        const div = document.createElement('div');
                        div.style = "padding:10px; border:1px solid #e2e8f0; border-radius:6px; display:flex; justify-content:space-between; align-items:center;";
                        div.innerHTML = `<span style="font-weight:600;">${song.title}</span><button class="btn danger" onclick="unpublishSong('${key}')">Unpublish 🔴</button>`;
                        libList.appendChild(div);
                    }
                }
            });
        }
        
        const counter = document.getElementById('live-count');
        if(counter) counter.innerText = liveCount + " Songs Live";
        
        UI.renderHybridSidebar();
    });

    // [NEW] 4. LISTEN FOR PERMANENT LOCAL MEDIA IN REALTIME DB
    onValue(ref(db, 'permanent_local_media'), (snapshot) => {
        const data = snapshot.val() || {};
        // Map the Firebase entries, and SORT them by their saved 'order'
        state.localMediaState = Object.keys(data).map(key => ({
            ...data[key],
            firebaseKey: key
        })).sort((a, b) => {
            const orderA = a.order !== undefined ? a.order : 9999;
            const orderB = b.order !== undefined ? b.order : 9999;
            return orderA - orderB;
        });
        
        // Refresh the sidebar and current view
        UI.renderHybridSidebar();
        
        // If the user is currently looking at the gallery, update it live
        if (window.currentSongData && window.currentSongData.type === 'local_set') {
            window.openLocalMediaGallery();
        }
    });
	
	// [NEW] 5. LISTEN FOR SAVED BACKGROUND MUSIC
    onValue(ref(db, 'saved_background_music'), (snapshot) => {
        const select = document.getElementById('saved-music-select');
        if (!select) return;
        
        // Reset the dropdown options
        select.innerHTML = '<option value="">-- Select Saved Music --</option>';
        
        if (snapshot.exists()) {
            const data = snapshot.val();
            // Populate the dropdown with saved music
            Object.keys(data).forEach(key => {
                const music = data[key];
                const option = document.createElement('option');
                option.value = music.url;
                option.text = music.name;
                option.setAttribute('data-key', key);
                select.appendChild(option);
            });
        }
    });
	

    window.fetchDriveImages();
    initSmartBroadcasting(); // Start WebRTC engine
};


// ==========================================
// --- LOCAL BACKGROUND MUSIC ENGINE ---
// ==========================================
let localYTAudioPlayer = null;
window.pendingYTId = null; // Auto-queue system

// This function is automatically called by the YouTube API once it loads
window.onYouTubeIframeAPIReady = function() {
    localYTAudioPlayer = new YT.Player('local-yt-audio-element', {
        height: '1', 
        width: '1', 
        videoId: '',
        playerVars: { 
            'autoplay': 0, 
            'controls': 0,
            'origin': window.location.origin // FIX: Squashes the CORS postMessage errors
        },
        events: {
            'onReady': function(event) {
                // FIX: If a song was clicked before the player loaded, play it instantly now!
                if (window.pendingYTId) {
                    event.target.loadVideoById(window.pendingYTId);
                    event.target.playVideo();
                    const volSlider = document.getElementById('local-volume');
                    if (volSlider) window.setLocalVolume(volSlider.value);
                    window.pendingYTId = null; 
                }
            }
        }
    });
};

// The control function for the Play/Stop buttons
window.controlLocalMusic = (action) => {
    const srcInput = document.getElementById('local-audio-url');
    if (!srcInput) return;
    
    let src = srcInput.value.trim();
    const mp3Player = document.getElementById('local-mp3-player');

    // Handle STOP
    if (action === 'stop') {
        mp3Player.pause();
        mp3Player.removeAttribute('src'); 
        mp3Player.load();
        if (localYTAudioPlayer && typeof localYTAudioPlayer.stopVideo === 'function') {
            localYTAudioPlayer.stopVideo();
        }
        window.pendingYTId = null;
        return;
    }

    if (!src) return;

    // --- FIX 1: SIMPLIFIED YOUTUBE EXTRACTOR ---
    let ytId = null;
    if (src.includes("youtu")) {
        // Catches standard, shortened, and mobile links flawlessly
        const match = src.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([a-zA-Z0-9_-]{11})/);
        if (match) ytId = match[1];
    } else if (src.length === 11 && !src.includes("/")) {
        ytId = src; // User just pasted the raw ID
    }

    // --- FIX 2: GOOGLE DRIVE LINK CONVERTER ---
    if (src.includes("drive.google.com")) {
        const driveMatch = src.match(/\/d\/([a-zA-Z0-9_-]+)/) || src.match(/id=([a-zA-Z0-9_-]+)/);
        if (driveMatch && driveMatch[1]) {
            src = `https://drive.google.com/uc?export=download&id=${driveMatch[1]}`;
        }
    }

    // Handle PLAY
    if (ytId) {
        // --- YouTube Audio Mode ---
        mp3Player.pause(); 
        mp3Player.removeAttribute('src'); 
        
        if (localYTAudioPlayer && typeof localYTAudioPlayer.loadVideoById === 'function') {
            localYTAudioPlayer.loadVideoById(ytId);
            localYTAudioPlayer.playVideo();
            
            const volSlider = document.getElementById('local-volume');
            if (volSlider) window.setLocalVolume(volSlider.value);
        } else {
            // FIX: Queue the video to play the millisecond the API is ready!
            window.pendingYTId = ytId;
            if (!localYTAudioPlayer && window.YT && window.YT.Player) {
                window.onYouTubeIframeAPIReady();
            }
        }
    } else {
        // --- MP3 / GOOGLE DRIVE Mode ---
        if (localYTAudioPlayer && typeof localYTAudioPlayer.stopVideo === 'function') {
            localYTAudioPlayer.stopVideo(); 
        }
        
        const volSlider = document.getElementById('local-volume');
        if (volSlider) window.setLocalVolume(volSlider.value);

        mp3Player.src = src;
        mp3Player.load(); 
        
        mp3Player.play().catch(e => {
            console.error("Audio playback blocked:", e);
            if (e.name === "NotSupportedError") {
                alert("ERROR: The browser cannot play this file.\n\nGOOGLE DRIVE CHECKLIST:\n1. Is it shared as 'Anyone with the link'?\n2. Is the file UNDER 100MB? (Google completely blocks direct streaming for large files).");
            } else {
                alert("Playback blocked. Please click anywhere on the page first to allow audio.");
            }
        });
    }
};

// --- SPEAKER & VOLUME CONTROLS ---
let isLocalMuted = false;

window.toggleLocalMute = () => {
    isLocalMuted = !isLocalMuted;
    const btn = document.getElementById('btn-local-mute');
    if(btn) {
        btn.innerText = isLocalMuted ? "🔇" : "🔊";
        btn.style.color = isLocalMuted ? "#ef4444" : "inherit"; 
    }
    
    const volSlider = document.getElementById('local-volume');
    if(volSlider) window.setLocalVolume(volSlider.value);
};

window.setLocalVolume = (val) => {
    const mp3Player = document.getElementById('local-mp3-player');
    const actualVolume = isLocalMuted ? 0 : (val / 100);
    
    if (mp3Player) mp3Player.volume = actualVolume;
    
    if (localYTAudioPlayer && typeof localYTAudioPlayer.setVolume === 'function') {
        localYTAudioPlayer.setVolume(isLocalMuted ? 0 : val);
    }
};

// ==========================================
// --- SAVED MUSIC LIBRARY FUNCTIONS ---
// ==========================================

window.saveLocalMusic = () => {
    const url = document.getElementById('local-audio-url').value.trim();
    const name = document.getElementById('local-audio-name').value.trim();
    
    if (!url || !name) {
        alert("Please enter both a URL and a Music Name to save.");
        return;
    }

    import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js').then(({ push, set, ref }) => {
        const newMusicRef = push(ref(db, 'saved_background_music'));
        set(newMusicRef, {
            name: name,
            url: url,
            timestamp: Date.now()
        }).then(() => {
            document.getElementById('local-audio-name').value = ""; 
        });
    });
};

window.loadSavedMusic = (url) => {
    if (url) document.getElementById('local-audio-url').value = url;
};

window.deleteSavedMusic = () => {
    const select = document.getElementById('saved-music-select');
    const selectedOption = select.options[select.selectedIndex];
    
    if (!selectedOption.value) return; 
    
    const key = selectedOption.getAttribute('data-key');
    if (confirm(`Are you sure you want to delete "${selectedOption.text}"?`)) {
        import('https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js').then(({ remove, ref }) => {
            remove(ref(db, `saved_background_music/${key}`));
            document.getElementById('local-audio-url').value = ""; 
        });
    }
};