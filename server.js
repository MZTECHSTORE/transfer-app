// server.js
// Aplicação Express real pronta para executar com Vendorapay API

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// 🔑 Variáveis de ambiente
const API_URL = process.env.VENDORAPAY_API_URL || "https://vendorapay.com/api";
const API_KEY = process.env.VENDORAPAY_API_KEY;
const PORT = process.env.PORT || 3000;

if (!API_KEY) {
  console.error("❌ Erro: API Key Vendorapay não definida no .env");
  process.exit(1);
}

// 🔁 Função genérica para enviar requisições à Vendorapay
async function vendorapayRequest(endpoint, data) {
  const headers = {
    "Content-Type": "application/json",
    "apiKey": API_KEY,
  };
  const url = `${API_URL}${endpoint.startsWith("/") ? endpoint : "/" + endpoint}`;
  const res = await axios.post(url, data, { headers });
  return res.data;
}

// 💳 Endpoint: criar transferência Visa → M-Pesa / eMola
app.post("/api/transfer", async (req, res) => {
  try {
    const { paymentMethod, amount, recipientPhone } = req.body;

    if (!paymentMethod || !amount || !recipientPhone)
      return res.status(400).json({ error: "Campos obrigatórios: paymentMethod, amount, recipientPhone" });

    let response;
    if (paymentMethod === "card") {
      // Pagamento por cartão
      response = await vendorapayRequest("/payment/create", {
        amount,
        currency: "MZN",
        context: "Transferência via cartão",
      });
    } else if (paymentMethod === "mpesa" || paymentMethod === "emola") {
      // Mobile Money
      response = await vendorapayRequest("/payment/mobile", {
        method: paymentMethod,
        amount,
        currency: "MZN",
        phone: recipientPhone,
      });
    } else {
      return res.status(400).json({ error: "Método inválido. Use: card, mpesa ou emola" });
    }

    res.json(response);
  } catch (err) {
    console.error("Erro Vendorapay:", err.response?.data || err.message);
    res.status(500).json({ error: "Falha na requisição à Vendorapay", details: err.message });
  }
});

// 🏠 Página principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// 🚀 Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT}`);
});
