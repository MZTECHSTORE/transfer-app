// server.js
// Requer: Node 18+ (recomendado)
// Instalar dependências: npm install express axios dotenv body-parser cors

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

// Variáveis de ambiente (ver .env)
const VENDORAPAY_API_URL = process.env.VENDORAPAY_API_URL;
const VENDORAPAY_API_KEY = process.env.VENDORAPAY_API_KEY;
const CALLBACK_URL = process.env.CALLBACK_URL;
const RETURN_URL = process.env.RETURN_URL;
const PORT = process.env.PORT || 3000;

if (!VENDORAPAY_API_URL || !VENDORAPAY_API_KEY) {
  console.error('ERRO: configure VENDORAPAY_API_URL e VENDORAPAY_API_KEY no .env');
  process.exit(1);
}

// Helper: chamada ao Vendorapay
async function vendorapayRequest(pathEndpoint, payload) {
  const url = `${VENDORAPAY_API_URL.replace(/\/$/, '')}/${pathEndpoint.replace(/^\//, '')}`;
  const headers = {
    'Content-Type': 'application/json',
    // A chave pode ter outro nome no header (ex: 'apiKey' ou 'Authorization: Bearer <key>')
    // Ajuste se o Vendorapay pedir outro formato.
    'apiKey': VENDORAPAY_API_KEY
  };
  const resp = await axios.post(url, payload, { headers });
  return resp.data;
}

// Rota para iniciar transferência: cartão -> M-Pesa / eMola
app.post('/api/transfer', async (req, res) => {
  try {
    const { paymentMethod, amount, currency, recipientPhone, customer } = req.body;
    // paymentMethod: 'card' | 'mpesa' | 'emola'
    if (!paymentMethod || !amount || !recipientPhone) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios faltando.' });
    }

    // 1) Se for cobrança por cartão, cria um pagamento no Vendorapay e captura
    if (paymentMethod === 'card') {
      // Observação importante: não envie PAN/CVV do cliente diretamente ao seu servidor em produção.
      // Use campos hospedados (hosted fields) do gateway para tokenização. Aqui o exemplo usa fluxo redirect/create que não envia PAN ao servidor.

      const createPayload = {
        amount: parseFloat(amount),
        currency: currency || 'MZN',
        context: `Cobrança cartão para enviar a ${recipientPhone}`,
        callbackUrl: CALLBACK_URL,
        returnUrl: RETURN_URL,
        enviroment: 'prod'
      };

      const createResp = await vendorapayRequest('/payment/create', createPayload);
      if (!createResp || !createResp.success) {
        return res.status(500).json({ success: false, message: 'Falha ao criar pagamento (card).', details: createResp });
      }

      // Retorna ao frontend a redirectUrl para checkout hospedado do Vendorapay
      return res.json({ success: true, message: 'Pagamento criado', redirectUrl: createResp.redirectUrl, transactionId: createResp.id });
    }

    // 2) Se cliente pagou por mobile money (mpesa/emola) --> iniciar mobile payment
    if (paymentMethod === 'mpesa' || paymentMethod === 'emola') {
      const mobilePayload = {
        method: paymentMethod,
        amount: parseFloat(amount),
        phone: recipientPhone,
        context: `Envio para ${recipientPhone}`,
        enviroment: 'prod'
      };

      const mobileResp = await vendorapayRequest('/payment/mobile', mobilePayload);
      if (!mobileResp || !mobileResp.success) {
        return res.status(500).json({ success: false, message: 'Falha no pagamento mobile.', details: mobileResp });
      }

      return res.json({ success: true, message: `Pagamento ${paymentMethod} iniciado`, details: mobileResp });
    }

    return res.status(400).json({ success: false, message: 'Método de pagamento inválido.' });

  } catch (err) {
    console.error('Erro /api/transfer:', err?.response?.data || err.message || err);
    return res.status(500).json({ success: false, message: 'Erro interno no servidor', error: err?.response?.data || err.message });
  }
});

// Webhook endpoint (Vendorapay deverá chamar esta URL para confirmar transações)
app.post('/webhook/vendorapay', async (req, res) => {
  // Verificar assinatura/secreto se o Vendorapay fornecer
  console.log('Webhook Vendorapay recebido:', JSON.stringify(req.body));
  // TODO: Validar e reconciliar a transação no teu banco
  res.status(200).json({ received: true });
});

// Fallback - serve index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Server rodando na porta ${PORT}`));
