// Aviso de mudança em tempo real (Ably).
// O banco continua sendo a única fonte dos dados: depois de cada gravação o servidor publica só
// { seq, origem } no canal, e cada navegador conectado faz UMA leitura de /api/db?acao=mudancas.
// Sem ABLY_API_KEY o recurso fica desligado e os navegadores usam a consulta periódica lenta.
import Ably from 'ably';

const chave = () => process.env.ABLY_API_KEY || '';
export const tempoRealAtivo = () => !!chave();
// Um canal por ambiente: o servidor local e as prévias nunca avisam a produção.
export const canalTempoReal = () => 'kelita-producao:' + (process.env.VERCEL_ENV || 'local');

let cliente = null;
function rest() {
  if (!cliente) cliente = new Ably.Rest({ key: chave() });
  return cliente;
}

// Publica o aviso. Uma falha aqui nunca derruba a gravação (os navegadores
// recuperam o atraso na próxima consulta de segurança).
export async function publicarMudanca(seq, origem) {
  if (!tempoRealAtivo() || !seq) return;
  try {
    await Promise.race([
      rest().channels.get(canalTempoReal()).publish('mudanca', { seq: Number(seq), origem: String(origem || '') }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('tempo esgotado')), 3000))
    ]);
  } catch (e) {
    console.error('[kelita] aviso em tempo real não publicado:', e.message || e);
  }
}

// Pedido de token assinado pelo servidor: o navegador só pode ESCUTAR o canal do ambiente.
export async function criarTokenTempoReal(clientId) {
  return rest().auth.createTokenRequest({
    clientId: String(clientId || 'anonimo'),
    capability: { [canalTempoReal()]: ['subscribe'] },
    ttl: 60 * 60 * 1000
  });
}
