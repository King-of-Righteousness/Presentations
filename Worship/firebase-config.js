import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyCWAxUm_Z_i-EP_xqayhQrwsL4Qkmh5fMA",
    authDomain: "slidesync-37cd4.firebaseapp.com",
    databaseURL: "https://slidesync-37cd4-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "slidesync-37cd4",
    storageBucket: "slidesync-37cd4.firebasestorage.app",
    messagingSenderId: "996754972458",
    appId: "1:996754972458:web:7f8be6880c3463ac6a4853",
    measurementId: "G-GCBS3X7STT"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const firestore = getFirestore(app);
export const db = getDatabase(app);