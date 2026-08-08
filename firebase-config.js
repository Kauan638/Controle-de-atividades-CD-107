// ============================================================
// CONFIGURAÇÃO FIREBASE
// Cole aqui as mesmas chaves que você já usa nos outros projetos
// (Rejeito-Geral, Expedição, etc.) — pode ser o MESMO projeto Firebase,
// as coleções abaixo são novas e não colidem com nada existente.
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyBtn2AsRlOwUEmVlo9_G6Zj89Yzl8vOvag",
  authDomain: "controle-de-atividades-cd-107.firebaseapp.com",
  projectId: "controle-de-atividades-cd-107",
  storageBucket: "controle-de-atividades-cd-107.firebasestorage.app",
  messagingSenderId: "296165470391",
  appId: "1:296165470391:web:190186997dd9078e0c9d32"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Coleções usadas neste projeto:
//   operadores/{matricula}      -> { nome }
//   enderecosChunks/{chunk_N}   -> { json: string com um pedaço do mapa de endereços }
//   meta/enderecos              -> { totalChunks, totalCount, updatedAt }
//   ajustes/{autoId}            -> { matricula, nome, tipo, endereco, codigo, descricao, qtd, timestamp }
