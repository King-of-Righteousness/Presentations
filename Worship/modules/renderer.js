import { state } from './state.js';
import { db } from '../firebase-config.js';
import { ref, set } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

export function renderTextToCanvas(text, reference = "", customOpts = null) {
    if(state.videoRenderLoop) cancelAnimationFrame(state.videoRenderLoop);
    
    const isNote = customOpts && customOpts.isNote;
    const isPreview = customOpts && customOpts.isPreview;
    const tempBgKey = customOpts && customOpts.tempBgKey;
    
    const noteSize = customOpts && customOpts.fontSize !== undefined ? customOpts.fontSize : state.textSettings.size;
    
    let dimValue = 0;
    if (isNote || isPreview) {
        dimValue = customOpts && customOpts.bgDim !== undefined ? customOpts.bgDim / 100 : 0.4;
    } else {
        if (state.textSettings.bgMedia) dimValue = 0.4;
        if (state.textSettings.bgImage) dimValue = 0.3;
    }

    // --- TEMPORARY BACKGROUND ISOLATION ---
    let activeBgMedia = state.textSettings.bgMedia;
    if ((isNote || isPreview) && tempBgKey) {
        activeBgMedia = { type: 'temp' }; // Bypasses global settings to dim canvas for temp video
    } 

    // Draw to Presenter Canvas Backgrounds
    if (activeBgMedia) {
        state.ctx.clearRect(0, 0, 1920, 1080);
        state.ctx.fillStyle = `rgba(0,0,0,${dimValue})`;
        state.ctx.fillRect(0, 0, 1920, 1080);
    } else if (state.textSettings.bgImage && !tempBgKey) { 
        state.ctx.drawImage(state.textSettings.bgImage, 0, 0, 1920, 1080); 
        state.ctx.fillStyle = `rgba(0,0,0,${dimValue})`; 
        state.ctx.fillRect(0, 0, 1920, 1080);
    } else { 
        state.ctx.fillStyle = state.textSettings.bg; 
        state.ctx.fillRect(0, 0, 1920, 1080);
        if (dimValue > 0) {
            state.ctx.fillStyle = `rgba(0,0,0,${dimValue})`;
            state.ctx.fillRect(0, 0, 1920, 1080);
        }
    }
    
    // Setup Font with disconnected size
    state.ctx.fillStyle = state.textSettings.color; 
    state.ctx.textAlign = state.textSettings.align; 
    state.ctx.textBaseline = 'middle';
    state.ctx.font = `bold ${noteSize}px ${state.textSettings.font}`;

    let x = 960; const pad = 100;
    const maxWidth = 1920 - (pad * 2);
    if(state.textSettings.align === 'left') x = pad;
    
    if (customOpts && customOpts.posX !== undefined && customOpts.posX !== null) {
        x = (customOpts.posX / 100) * 1920;
    }
    
    const safeText = String(text);
    const rawLines = safeText.split('\n'); 
    let wrappedLines = [];
    
    rawLines.forEach(line => {
        const words = line.split(' '); let currentLine = words[0];
        for (let i = 1; i < words.length; i++) {
            const word = words[i];
            const width = state.ctx.measureText(currentLine + " " + word).width;
            if (width < maxWidth) currentLine += " " + word;
            else { wrappedLines.push(currentLine); currentLine = word; }
        }
        wrappedLines.push(currentLine);
    });
    
    const lineHeight = noteSize * 1.4; 
    let startY = 540 - ((wrappedLines.length * lineHeight) / 2) + (lineHeight / 2);
    if (reference.includes(":")) startY -= 40;

    if (customOpts && customOpts.posY !== undefined && customOpts.posY !== null) {
        startY = ((customOpts.posY / 100) * 1080) - ((wrappedLines.length * lineHeight) / 2) + (lineHeight / 2);
    }

    wrappedLines.forEach((line, i) => { state.ctx.fillText(line, x, startY + (i * lineHeight)); });
    
    if (reference.includes(":")) {
        state.ctx.font = `bold ${Math.max(30, noteSize * 0.4)}px ${state.textSettings.font}`;
        state.ctx.fillStyle = "#FACC15"; state.ctx.textAlign = "center"; state.ctx.fillText(reference, 960, 1000);
    }

    if (isPreview) {
        broadcastFrame('local');
        return;
    }

    if (isNote) {
        broadcastFrame('all');
        set(ref(db, 'presentation/text'), { text: "" }); 
        return;
    }

    broadcastFrame('local');
    const textPayload = {
        text: text,
        reference: reference.includes(":") ? reference : "", 
        size: state.textSettings.size, 
        align: state.textSettings.align,
        font: state.textSettings.font,
        color: state.textSettings.color,
        bg: (state.textSettings.bgImage || state.textSettings.bgMedia) ? 'transparent' : state.textSettings.bg
    };
    set(ref(db, 'presentation/text'), textPayload);
    set(ref(db, 'presentation/liveView'), 'clear_image');
}

export function renderImageToCanvas(src) {
    if(state.videoRenderLoop) cancelAnimationFrame(state.videoRenderLoop);
    set(ref(db, 'presentation/text'), { text: "" });

    const img = new Image();
    img.onload = () => {
        state.ctx.fillStyle = "black"; state.ctx.fillRect(0, 0, 1920, 1080);
        const ratio = Math.min(1920 / img.width, 1080 / img.height);
        const x = (1920 - img.width * ratio) / 2;
        const y = (1080 - img.height * ratio) / 2;
        state.ctx.drawImage(img, 0, 0, img.width, img.height, x, y, img.width*ratio, img.height*ratio);
        broadcastFrame('all');
    };
    img.src = src;
}

export function renderVideoToCanvas(src, shouldBroadcast = true) {
    set(ref(db, 'presentation/text'), { text: "" });

    const video = document.createElement('video');
    video.src = src;
    video.muted = true; video.loop = true; video.play();
    if (state.videoRenderLoop) cancelAnimationFrame(state.videoRenderLoop);
    function step() {
        if(video.paused || video.ended) return;
        state.ctx.fillStyle = "black";
        state.ctx.fillRect(0, 0, 1920, 1080);
        const ratio = Math.min(1920 / video.videoWidth, 1080 / video.videoHeight);
        state.ctx.drawImage(video, (1920 - video.videoWidth * ratio) / 2, (1080 - video.videoHeight * ratio) / 2, video.videoWidth * ratio, video.videoHeight * ratio);
        if(shouldBroadcast) broadcastFrame('all');
        state.videoRenderLoop = requestAnimationFrame(step);
    }
    video.onloadeddata = () => step();
}

export function broadcastFrame(target) {
    const dataURL = state.canvas.toDataURL('image/webp', 0.95);
    if ((target === 'all' || target === 'local') && state.audienceWindow && !state.audienceWindow.closed) state.audienceWindow.updateDisplay('image', dataURL);
    if (target === 'all' || target === 'firebase') set(ref(db, 'presentation/liveView'), dataURL);
}

export function drawPlaceholder(title, sub) {
    state.ctx.fillStyle = "black";
    state.ctx.fillRect(0, 0, 1920, 1080);
    state.ctx.fillStyle = "#8b5cf6"; 
    state.ctx.textAlign = "center"; 
    state.ctx.textBaseline = "middle";
    state.ctx.font = "bold 60px Inter, sans-serif";
    state.ctx.fillText(title, 960, 500);
    state.ctx.fillStyle = "white"; 
    state.ctx.font = "30px Inter, sans-serif";
    state.ctx.fillText(sub, 960, 580);
}