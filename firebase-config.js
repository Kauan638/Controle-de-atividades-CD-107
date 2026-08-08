// ============================================================
// CONFIGURAÇÃO FIREBASE
// Cole aqui as mesmas chaves que você já usa nos outros projetos
// (Rejeito-Geral, Expedição, etc.) — pode ser o MESMO projeto Firebase,
// as coleções abaixo são novas e não colidem com nada existente.
// ============================================================
const firebaseConfig = {
  apiKey: "COLE_AQUI",
  authDomain: "COLE_AQUI",
  projectId: "COLE_AQUI",
  storageBucket: "COLE_AQUI",
  messagingSenderId: "COLE_AQUI",
  appId: "COLE_AQUI"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Coleções usadas neste projeto:
//   operadores/{matricula}  -> { nome, senha, ativo }
//   enderecos/{endereco}    -> { codigo, descricao }
//   ajustes/{autoId}        -> { matricula, nome, tipo, endereco, codigo, descricao, qtd, timestamp }
