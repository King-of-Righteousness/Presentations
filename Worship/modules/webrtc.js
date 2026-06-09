 import { state } from './state.js';
import { db } from '../firebase-config.js';
import { ref, set, onValue, onDisconnect, push } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

export function initSmartBroadcasting() {
    console.log("🚀 Initializing Smart Broadcaster...");
    const config = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
    state.peerConnection = new RTCPeerConnection(config);

    if (state.canvas) {
        const stream = state.canvas.captureStream(30);
        stream.getTracks().forEach(track => state.peerConnection.addTrack(track, stream));
    }

    state.peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            push(ref(db, 'presentation/webrtc/presenter_candidates'), event.candidate.toJSON());
        }
    };

    state.peerConnection.createOffer().then(offer => {
        return state.peerConnection.setLocalDescription(offer);
    }).then(() => {
        set(ref(db, 'presentation/webrtc/offer'), {
            type: state.peerConnection.localDescription.type,
            sdp: state.peerConnection.localDescription.sdp
        });
    }).catch(e => console.error("WebRTC Offer Error:", e));

    onValue(ref(db, 'presentation/webrtc/answer'), (snapshot) => {
        const answer = snapshot.val();
        if (answer && !state.peerConnection.currentRemoteDescription) {
            const rtcDesc = new RTCSessionDescription(answer);
            state.peerConnection.setRemoteDescription(rtcDesc);
        }
    });

    onValue(ref(db, 'presentation/webrtc/audience_candidates'), (snapshot) => {
        snapshot.forEach((child) => {
            state.peerConnection.addIceCandidate(new RTCIceCandidate(child.val()));
        });
    });

    onDisconnect(ref(db, 'presentation/webrtc')).remove();
}