// ═══════════════════════════════════════════════════
//  CHRONO — Firebase Config
//  Preencha com suas credenciais do Firebase Console
//  console.firebase.google.com → Seu projeto →
//  Configurações do projeto → Seus apps → CDN
// ═══════════════════════════════════════════════════

import { initializeApp }  from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth }        from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore }   from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getStorage }     from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

const firebaseConfig = {
    apiKey: "AIzaSyBjDPUAzwaG99-lMtRxpce2rzsfvwK61sw",
    authDomain: "chrono-app-77445.firebaseapp.com",
    projectId: "chrono-app-77445",
    storageBucket: "chrono-app-77445.firebasestorage.app",
    messagingSenderId: "904704988952",
    appId: "1:904704988952:web:19e280fc1d7546790df06d"
  };

const app = initializeApp(firebaseConfig);

export const auth    = getAuth(app);
export const db      = getFirestore(app);
export const storage = getStorage(app);
