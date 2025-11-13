// server.js
// Requisitos: Node 18+
// Instalar dependências: npm install express axios dotenv body-parser cors crypto

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

// Variáveis de ambiente (defina no .env)
const VENDORAPAY_API_URL = process.env.VENDORAPAY_API_URL;    // ex: https://vendorapay.com/api
const VENDORAPAY_API_KEY = process.env.VENDORAPAY_API_KEY;    // tua API Key (nunca commit no git)
const VENDORAPAY_WEBHOOK_SECRET = process.env.VENDORAPAY_WEBHOOK_SECRET || ''; // se Vendorapay fornecer assinatura
const CALLBACK_URL = process.env.CALLBACK_URL || '';          // webhook público
const RETURN_URL = process.env.RETURN_URL || '';              // URL de retorno pós-checkout
const PORT = process.env.PORT || 3000;

if (!VENDORAPAY_API_URL || !VENDORAPAY_API_KEY) {
  console.error('ERRO: defina VENDORAPAY_API_URL e VENDORAPAY_API_KEY no .env');
  process.exit(1);
}

// Helper para chamar Vendorapay
async function vendorapayRequest(endpointPath, payload) {
  const base = VENDORAPAY_API_URL.replace(/\/$/, '');
  const url = `${base}/${endpointPath.replace(/^\//, '')}`;
  const headers = {
    'Content-Type': 'application/json',
    // Ajuste o header conforme o que o Vendorapay exige; se precisar usar Authorization: Bearer <key>, altere aqui
    'apiKey':tpkhv80bbjago1qm13ldt23b6k971u6mqg30ca1h2rlku4dw78r6z560g07t


  };

  const resp = await axios.post(url, payload, { headers, timeout: 20000 });
  return resp.data;
}

// Rota: transfer (Visa/Mastercard -> M-Pesa / eMola)
// Corpo esperado JSON:
// {
//   "paymentMethod": "card" | "mpesa" | "emola",
//   "amount": 2500,
//   "currency": "MZN",
//   "recipientPhone": "841234567",
//   "customer": { "name": "...", "email": "...", "reference": "order_123" }
// }
app.post('/api/transfer', async (req, res) => {
  try {
    const { paymentMethod, amount, currency, recipientPhone, customer } = req.body;

    if (!paymentMethod || !amount || !recipientPhone) {
      return res.status(400).json({ success: false, message: 'Campos obrigatórios faltando: paymentMethod, amount, recipientPhone' });
    }

    // Normalize
    const amt = parseFloat(amount);
    const cur = currency || 'MZN';

    // 1) Pagamento por cartão — cria checkout no Vendorapay (hosted checkout)
    if (paymentMethod === 'card') {
      const payload = {
        amount: amt,
        currency: cur,
        context: customer?.reference ? `Order ${customer.reference}` : `Pagamento cartão para ${recipientPhone}`,
        callbackUrl: CALLBACK_URL,
        returnUrl: RETURN_URL,
        enviroment: 'prod'
      };

      const createResp = await vendorapayRequest('/payment/create', payload);

      if (!createResp || !createResp.success) {
        console.error('Vendorapay /payment/create error:', createResp);
        return res.status(502).json({ success: false, message: 'Falha ao criar pagamento por cartão', details: createResp });
      }

      // Retorna redirectUrl para o frontend redirecionar o cliente ao checkout hospedado
      return res.json({
        success: true,
        message: 'Pagamento por cartão criado. Redirecione o cliente para o checkout.',
        redirectUrl: createResp.redirectUrl,
        transactionId: createResp.id,
        vendorResponse: createResp
      });
    }

    // 2) Pagamento mobile money (iniciar pedido mobile via Vendorapay)
    if (paymentMethod === 'mpesa' || paymentMethod === 'emola') {
      const payload = {
        method: paymentMethod,     // 'mpesa' ou 'emola'
        amount: amt,
        currency: cur,
        phone: recipientPhone,
        context: customer?.reference ? `Payout ${customer.reference}` : `Payout para ${recipientPhone}`,
        enviroment: 'prod'
      };

      const mobileResp = await vendorapayRequest('/payment/mobile', payload);

      if (!mobileResp || !mobileResp.success) {
        console.error('Vendorapay /payment/mobile error:', mobileResp);
        return res.status(502).json({ success: false, message: 'Falha ao iniciar pagamento mobile', details: mobileResp });
      }

      // mobileResp normalmente contém um id, status e possivelmente uma URL/operador
      return res.json({
        success: true,
        message: `Pagamento ${paymentMethod} iniciado.`,
        details: mobileResp
      });
    }

    return res.status(400).json({ success: false, message: 'paymentMethod inválido. Use: card, mpesa ou emola' });
  } catch (err) {
    console.error('Erro /api/transfer:', err?.response?.data || err.message || err);
    const details = err?.response?.data || err.message;
    return res.status(500).json({ success: false, message: 'Erro interno do servidor', error: details });
  }
});

// Webhook endpoint para receber notificações do Vendorapay
app.post('/webhook/vendorapay', express.raw({ type: '*/*' }), async (req, res) => {
  try {
    const rawBody = req.body; // Buffer
    const signatureHeader = req.headers['x-vendorapay-signature'] || req.headers['x-signature'] || '';

    // Se houver segredo configurado, valida assinatura HMAC (exemplo)
    if (VENDORAPAY_WEBHOOK_SECRET) {
      const computed = crypto.createHmac('sha256', VENDORAPAY_WEBHOOK_SECRET).update(rawBody).digest('hex');
      if (!signatureHeader || (signatureHeader !== computed)) {
        console.warn('Webhook assinatura inválida', { signatureHeader, computed });
        return res.status(401).json({ received: false, message: 'Assinatura inválida' });
      }
    }

    // Parse JSON
    let event;
    try {
      event = JSON.parse(rawBody.toString('utf8'));
    } catch (e) {
      console.warn('Webhook: body não é JSON', e);
      return res.status(400).json({ received: false, message: 'Payload inválido' });
    }

    console.log('Webhook Vendorapay recebido:', JSON.stringify(event));

    // Exemplo: processa evento (adaptar conforme payload real do Vendorapay)
    // if (event.type === 'payment.completed') { ... marcar order como paga ... }

    // TODO: implementar lógica de reconciliação (guardar em DB, notificar cliente, etc.)

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Erro no webhook:', err);
    return res.status(500).json({ received: false, message: 'Erro interno' });
  }
});

// fallback: serve index
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`✅ Servidor rodando em http://localhost:${PORT} (porta ${PORT})`);
});
