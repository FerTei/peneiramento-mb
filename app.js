/* ============================================================
   app.js - toda a lógica do aplicativo "Peneiramento MB"

   COMO LER ESTE ARQUIVO (de cima para baixo):
     1. Ferramentas básicas e dados salvos
     2. Balança Bluetooth
     3. Telas (o que aparece na tela)
     4. Navegação entre telas
     5. Planejamento do projeto
     6. Peneiramento (registro dos bags)
     7. Relatórios e compartilhamento

   Dica: as funções são "globais" (não estão dentro de módulos)
   porque os botões do HTML chamam por nome, ex: onclick="reg()".
   ============================================================ */


/* ============================================================
   1. FERRAMENTAS BÁSICAS E DADOS SALVOS
   ============================================================ */

// Atalho: $('#id') no lugar de document.querySelector('#id')
const $ = seletor => document.querySelector(seletor);

// Área da página onde as telas são desenhadas (<main id="app"> do index.html)
const app = $('#app');

// DB = "banco de dados" simples, usando o armazenamento do navegador (localStorage).
//   DB.get('chave', valorPadrao) -> lê um dado salvo
//   DB.set('chave', valor)       -> grava um dado
// Os dados ficam no celular e continuam lá depois de fechar o app.
const DB = {
  get: (chave, padrao) => {
    try { return JSON.parse(localStorage.getItem(chave)) ?? padrao; }
    catch { return padrao; }
  },
  set: (chave, valor) => localStorage.setItem(chave, JSON.stringify(valor))
};

// esc() deixa um texto "seguro" para colocar dentro de HTML.
// Troca caracteres como < > & " por códigos, evitando que um texto digitado
// pelo usuário quebre a tela. Use sempre que mostrar texto digitado.
const esc = texto => String(texto ?? '').replace(/[&<>"]/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'
}[c]));

// ---- DADOS DO APP (carregados do celular ao abrir) ----
let plan = DB.get('plan', null);   // planejamento do projeto (cliente, camadas...)
let recs = DB.get('recs', []);     // lista de bags registrados
let reps = DB.get('reps', []);     // lista de relatórios gerados

// Estado da balança:
//   dev = dispositivo Bluetooth conectado (ou null)
//   kg  = último peso recebido (ou null)
//   buf = texto recebido da balança, acumulado até formar um peso completo
let scale = { dev: null, kg: null, manual: false, buf: '' };


/* ============================================================
   2. BALANÇA (BLUETOOTH BLE)
   Usa a "Web Bluetooth", que só funciona no Chrome (Android/PC)
   e em páginas com endereço seguro (https://).
   ============================================================ */

// Lista de "serviços" Bluetooth comuns em balanças e adaptadores.
// Como não sabemos qual a Prix Rebanho usa, listamos vários e o app
// procura dados em todos eles.
const SVC = [
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000181d-0000-1000-8000-00805f9b34fb'
];

// parse(): recebe pedaços de texto vindos da balança e procura um peso.
// A balança manda algo como "12.5 kg". A expressão regular abaixo
// procura: número com uma casa decimal (ponto ou vírgula) + "kg".
function parse(texto) {
  // Guarda só os últimos 200 caracteres (o resto não interessa)
  scale.buf = (scale.buf + texto).slice(-200);

  // matchAll acha todas as ocorrências; .pop() pega a mais recente
  const achado = [...scale.buf.matchAll(/(-?\d{1,5}[.,]\d)\s*kg/gi)].pop();

  if (achado) {
    // troca vírgula por ponto para converter em número
    scale.kg = parseFloat(achado[1].replace(',', '.'));
    // atualiza o número grande na tela, se ele estiver visível
    const el = $('#wt');
    if (el) el.textContent = scale.kg.toFixed(1) + ' kg';
  }
}

// pair(): abre a janela do Chrome para escolher a balança e conecta.
// "async/await" = espera cada etapa terminar antes de seguir.
async function pair() {
  if (!navigator.bluetooth) {
    alert('Web Bluetooth indisponível. Use Chrome no Android.');
    return;
  }
  try {
    // Mostra só aparelhos cujo nome começa com "Prix" (ex: Prix_Reb_1234)
    const d = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: 'Prix' }],
      optionalServices: SVC
    });
    const servidor = await d.gatt.connect();
    scale.dev = d;
    let canais = 0;

    // Percorre todos os serviços e canais do aparelho. Em cada canal que
    // "avisa" quando chega dado (notify/indicate), liga a escuta.
    for (const servico of await servidor.getPrimaryServices()) {
      for (const canal of await servico.getCharacteristics()) {
        if (canal.properties.notify || canal.properties.indicate) {
          await canal.startNotifications();
          // Toda vez que chegar dado novo, converte bytes em texto e analisa
          canal.addEventListener('characteristicvaluechanged', e =>
            parse(new TextDecoder().decode(e.target.value))
          );
          canais++;
        }
      }
    }

    // Se a balança desligar/desconectar, limpa o estado e redesenha a tela
    d.addEventListener('gattserverdisconnected', () => {
      scale.dev = null;
      render();
    });

    alert(canais
      ? 'Balança conectada (' + canais + ' canal(is) de dados).'
      : 'Conectou, mas nenhum canal de dados foi encontrado.');
  } catch (e) {
    alert('Falha no pareamento: ' + e.message);
  }
  render();
}


/* ============================================================
   3. TELAS
   V (de "Views") é um objeto com uma função por tela.
   Cada função devolve um texto HTML entre crases (`...`).
   Dentro das crases, ${...} insere valores do JavaScript.
   Para CRIAR UMA TELA NOVA: adicione uma função aqui e um botão
   no menu (tela "home") com onclick="go('nome_da_tela')".
   ============================================================ */
const V = {

  // ---- Menu inicial ----
  home() {
    return `<div class="menu">
      <button onclick="go('plan')">📋 Planejamento do Projeto<br>
        <span class="m" style="color:#cde">${plan ? esc(plan.projeto) + ' · ' + esc(plan.cliente) : 'Não cadastrado'}</span></button>
      <button onclick="go('scale')">⚖️ Balança Prix Rebanho<br>
        <span class="m" style="color:#cde">${scale.dev ? 'Conectada: ' + esc(scale.dev.name) : 'Não conectada'}</span></button>
      <button onclick="go('work')">🧪 Peneiramento (registrar bags)<br>
        <span class="m" style="color:#cde">${recs.length} bag(s) registrado(s)</span></button>
      <button onclick="go('rep')">📄 Relatórios e compartilhamento<br>
        <span class="m" style="color:#cde">${reps.length} relatório(s) salvo(s)</span></button>
    </div>`;
  },

  // ---- Planejamento do projeto ----
  plan() {
    // Se ainda não existe planejamento, começa com uma camada vazia
    const p = plan || { layers: [{ cat: '', bags: '' }] };
    return `<button class="back" onclick="go('home')">← Menu</button>
    <div class="card"><b>Planejamento do Projeto</b>
      <label>Nome do cliente</label><input id="pc" value="${esc(p.cliente)}">
      <label>Nome do projeto</label><input id="pp" value="${esc(p.projeto)}">
      <label>Quantidade de camadas</label>
      <input id="pn" type="number" min="1" max="12" value="${p.layers.length}" onchange="lay()">
      <div id="lays">${p.layers.map((l, i) => layHtml(i, l)).join('')}</div>
      <label>Responsável pelo planejamento</label><input id="pr" value="${esc(p.resp)}">
      <label>Contato do responsável</label><input id="pt" value="${esc(p.contato)}">
      <button onclick="savePlan()">Salvar planejamento</button>
    </div>`;
  },

  // ---- Balança ----
  scale() {
    return `<button class="back" onclick="go('home')">← Menu</button>
    <div class="card"><b>Balança Prix Rebanho</b>
      <p class="m">Ligue a balança (parâmetro C06 = APP) e pareie. O nome aparece como Prix_Reb_xxxx.</p>
      <div class="w" id="wt">${scale.kg == null ? '--' : scale.kg.toFixed(1) + ' kg'}</div>
      <button onclick="pair()">${scale.dev ? 'Parear outra balança' : 'Parear balança'}</button>
      ${scale.dev ? '<button class="s" onclick="scale.dev.gatt.disconnect()">Desconectar</button>' : ''}
    </div>`;
  },

  // ---- Peneiramento (registro dos bags) ----
  work() {
    // Sem planejamento não há camadas para escolher
    if (!plan) {
      return `<button class="back" onclick="go('home')">← Menu</button>
      <div class="card">Cadastre o planejamento primeiro.</div>`;
    }
    // Monta as opções da lista "Camada" a partir do planejamento
    const opcoes = plan.layers.map((l, i) =>
      `<option value="${i}">Camada ${i + 1} — ${esc(l.cat)}</option>`).join('');

    return `<button class="back" onclick="go('home')">← Menu</button>
    <div class="card">
      <div class="w" id="wt">${scale.kg == null ? '--' : scale.kg.toFixed(1) + ' kg'}</div>
      <p class="m" style="text-align:center">${scale.dev ? 'Balança conectada' : 'Balança desconectada — digite o peso abaixo'}</p>
      <label>Peso manual (opcional, se sem balança)</label>
      <input id="wm" type="number" step="0.1" inputmode="decimal">
      <label>Camada</label>
      <select id="wl" onchange="ct()">${opcoes}</select>
      <label>Catalisador (automático)</label><input id="wc" readonly>
      <label>Identificação do bag (QR Code)</label>
      <div class="row"><input id="wb"><button class="a" style="margin:0" onclick="qr()">📷 Ler</button></div>
      <video id="vid" hidden playsinline></video>
      <label>Estado do material</label>
      <select id="ws">
        <option>Catalisador ainda útil</option>
        <option>Quebrado</option>
        <option>Pó</option>
      </select>
      <label>Notas</label><textarea id="wn" rows="2"></textarea>
      <button onclick="reg()">✔ Registrar peso final do bag</button>
    </div>

    <div class="card"><b>Registros (${recs.length})</b>
      <table>
        <tr><th>Bag</th><th>Cam.</th><th>Estado</th><th>kg</th><th></th></tr>
        ${recs.slice().reverse().map((r, i) =>
          `<tr><td>${esc(r.bag)}</td><td>${r.camada}</td><td>${esc(r.estado)}</td><td>${r.peso}</td>
           <td onclick="del(${recs.length - 1 - i})">🗑</td></tr>`).join('')}
      </table>
    </div>`;
  },

  // ---- Relatórios ----
  rep() {
    return `<button class="back" onclick="go('home')">← Menu</button>
    <div class="card"><b>Relatórios</b>
      <button onclick="mkRep()">Gerar relatório com os dados atuais</button>
      <button class="r" onclick="limparRegistros()">Limpar registros de bags</button>
    </div>
    ${reps.map((r, i) => `<div class="card"><b>${esc(r.nome)}</b>
      <div class="m">${r.n} bag(s) · ${r.total.toFixed(1)} kg</div>
      <div class="row">
        <button class="s" onclick="view(${i})">Ver</button>
        <button onclick="share(${i},'html')">Enviar</button>
        <button class="s" onclick="share(${i},'csv')">CSV</button>
        <button class="r" onclick="delRep(${i})">🗑</button>
      </div></div>`).join('')}`;
  }
};


/* ============================================================
   4. NAVEGAÇÃO ENTRE TELAS
   ============================================================ */

let cur = 'home';   // nome da tela atual

// render(): redesenha a tela atual dentro de <main id="app">
function render() {
  app.innerHTML = V[cur]();
  if (cur === 'work') ct();   // preenche o campo "Catalisador" na tela de trabalho
}

// go('nome'): troca de tela e volta ao topo da página
function go(tela) {
  cur = tela;
  render();
  scrollTo(0, 0);
}

// A cada 0,4 s, atualiza o número do peso na tela de trabalho
setInterval(() => {
  if (cur === 'work' && scale.kg != null) {
    const el = $('#wt');
    if (el) el.textContent = scale.kg.toFixed(1) + ' kg';
  }
}, 400);


/* ============================================================
   5. PLANEJAMENTO DO PROJETO
   ============================================================ */

// layHtml(): HTML de UMA camada (campo do catalisador + campo de bags)
const layHtml = (i, l) => `<div class="row">
  <div><label>Camada ${i + 1}: catalisador</label><input class="lc" value="${esc(l.cat)}"></div>
  <div><label>Bags</label><input class="lb" type="number" inputmode="numeric" value="${esc(l.bags)}"></div>
</div>`;

// lay(): chamada quando muda a "Quantidade de camadas".
// Refaz a lista de camadas mantendo o que já foi digitado.
function lay() {
  const n = Math.max(1, Math.min(12, +$('#pn').value || 1));   // limita entre 1 e 12
  const antigos = [...document.querySelectorAll('.lc')].map((el, i) => ({
    cat: el.value,
    bags: document.querySelectorAll('.lb')[i].value
  }));
  $('#lays').innerHTML = Array.from({ length: n }, (_, i) =>
    layHtml(i, antigos[i] || { cat: '', bags: '' })).join('');
}

// savePlan(): lê todos os campos, monta o objeto "plan" e salva no celular
function savePlan() {
  const cats = [...document.querySelectorAll('.lc')];
  const bags = [...document.querySelectorAll('.lb')];
  plan = {
    cliente: $('#pc').value,
    projeto: $('#pp').value,
    resp:    $('#pr').value,
    contato: $('#pt').value,
    layers:  cats.map((c, i) => ({ cat: c.value, bags: bags[i].value }))
  };
  DB.set('plan', plan);
  alert('Planejamento salvo');
  go('home');
}


/* ============================================================
   6. PENEIRAMENTO (REGISTRO DOS BAGS)
   ============================================================ */

// ct(): preenche o campo "Catalisador (automático)" conforme a camada escolhida
function ct() {
  const camada = plan.layers[+$('#wl').value];
  $('#wc').value = camada ? camada.cat : '';
}

// qr(): liga a câmera traseira e lê um QR Code com o leitor do próprio navegador
async function qr() {
  const video = $('#vid');
  if (!('BarcodeDetector' in window)) {
    alert('Leitor de QR não suportado neste navegador. Digite o código manualmente.');
    return;
  }
  try {
    const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = camera;
    video.hidden = false;
    await video.play();

    const detector = new BarcodeDetector({ formats: ['qr_code'] });

    // Tenta ler um QR a cada 0,3 s. Ao achar: preenche o campo,
    // para o timer, desliga a câmera e esconde o vídeo.
    const timer = setInterval(async () => {
      try {
        const lidos = await detector.detect(video);
        if (lidos.length) {
          $('#wb').value = lidos[0].rawValue;
          clearInterval(timer);
          camera.getTracks().forEach(t => t.stop());
          video.hidden = true;
        }
      } catch {}
    }, 300);
  } catch (e) {
    alert('Câmera: ' + e.message);
  }
}

// reg(): registra um bag (peso + camada + identificação + estado + notas)
function reg() {
  // Se digitou peso manual, usa ele; senão usa o peso da balança
  const manual = parseFloat($('#wm').value);
  const peso = !isNaN(manual) ? manual : scale.kg;

  if (peso == null || isNaN(peso)) { alert('Sem peso da balança.'); return; }
  if (!$('#wb').value.trim())      { alert('Informe a identificação do bag.'); return; }

  const iCamada = +$('#wl').value;   // posição da camada escolhida (começa em 0)

  // Adiciona o registro à lista e salva no celular
  recs.push({
    bag:    $('#wb').value.trim(),
    camada: iCamada + 1,
    cat:    plan.layers[iCamada].cat,
    estado: $('#ws').value,
    peso:   +peso.toFixed(1),
    notas:  $('#wn').value,
    dh:     new Date().toLocaleString('pt-BR')   // data e hora do registro
  });
  DB.set('recs', recs);
  render();
  navigator.vibrate && navigator.vibrate(120);   // vibra o celular como confirmação
}

// del(): exclui um registro da lista (pede confirmação)
function del(i) {
  if (confirm('Excluir este registro?')) {
    recs.splice(i, 1);
    DB.set('recs', recs);
    render();
  }
}

// limparRegistros(): apaga TODOS os bags registrados (pede confirmação)
function limparRegistros() {
  if (confirm('Apagar TODOS os registros de bags?')) {
    recs = [];
    DB.set('recs', recs);
    alert('Registros apagados');
  }
}


/* ============================================================
   7. RELATÓRIOS E COMPARTILHAMENTO
   ============================================================ */

// mkRep(): gera um relatório (versão HTML e versão CSV) com os dados atuais
function mkRep() {
  if (!plan || !recs.length) { alert('Faltam planejamento ou registros.'); return; }

  // Peso total e peso somado por estado do material
  const total = recs.reduce((soma, r) => soma + r.peso, 0);
  const porEstado = {};
  recs.forEach(r => porEstado[r.estado] = (porEstado[r.estado] || 0) + r.peso);

  // Linhas da tabela "Resumo por camada"
  const linhasCamada = plan.layers.map((l, i) => {
    const rr = recs.filter(r => r.camada == i + 1);   // bags dessa camada
    return `<tr><td>${i + 1}</td><td>${esc(l.cat)}</td><td>${l.bags}</td>
      <td>${rr.length}</td><td>${rr.reduce((a, r) => a + r.peso, 0).toFixed(1)}</td></tr>`;
  }).join('');

  // ---- Relatório em HTML (um arquivo completo, com o logo dentro) ----
  const html = `<html><head><meta charset="utf-8"><title>Relatório</title>
<style>body{font:14px sans-serif;padding:16px}table{border-collapse:collapse;width:100%;margin:8px 0}td,th{border:1px solid #bbb;padding:4px;text-align:left}img{height:40px}</style></head>
<body><img src="${LOGO}"><h2>Relatório de Peneiramento de Catalisador</h2>
<p><b>Cliente:</b> ${esc(plan.cliente)}<br><b>Projeto:</b> ${esc(plan.projeto)}<br>
<b>Responsável:</b> ${esc(plan.resp)} — ${esc(plan.contato)}<br>
<b>Emitido em:</b> ${new Date().toLocaleString('pt-BR')}</p>
<h3>Resumo por camada</h3>
<table><tr><th>Camada</th><th>Catalisador</th><th>Bags plan.</th><th>Bags real.</th><th>Peso (kg)</th></tr>${linhasCamada}</table>
<h3>Por estado</h3>
<table>${Object.entries(porEstado).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.toFixed(1)} kg</td></tr>`).join('')}
<tr><th>Total</th><th>${total.toFixed(1)} kg</th></tr></table>
<h3>Detalhe</h3>
<table><tr><th>Data/hora</th><th>Bag</th><th>Cam.</th><th>Catalisador</th><th>Estado</th><th>kg</th><th>Notas</th></tr>
${recs.map(r => `<tr><td>${r.dh}</td><td>${esc(r.bag)}</td><td>${r.camada}</td><td>${esc(r.cat)}</td><td>${esc(r.estado)}</td><td>${r.peso}</td><td>${esc(r.notas)}</td></tr>`).join('')}</table>
</body></html>`;

  // ---- Relatório em CSV (abre no Excel; separador é ponto e vírgula) ----
  const csv = 'Data/hora;Bag;Camada;Catalisador;Estado;Peso kg;Notas\n' +
    recs.map(r => [
      r.dh, r.bag, r.camada, r.cat, r.estado,
      String(r.peso).replace('.', ','),              // decimal com vírgula (padrão brasileiro)
      (r.notas || '').replace(/[;\n]/g, ' ')         // tira ; e quebras de linha das notas
    ].join(';')).join('\n');

  // unshift = coloca o relatório novo no INÍCIO da lista
  reps.unshift({
    nome: plan.projeto + ' — ' + new Date().toLocaleString('pt-BR'),
    n: recs.length,
    total,
    html,
    csv
  });
  DB.set('reps', reps);
  render();
}

// view(): abre o relatório numa nova aba
function view(i) {
  const janela = open();
  janela.document.write(reps[i].html);
}

// delRep(): apaga um relatório salvo
function delRep(i) {
  if (confirm('Apagar este relatório?')) {
    reps.splice(i, 1);
    DB.set('reps', reps);
    render();
  }
}

// share(): envia o relatório pelo menu "Compartilhar" do celular
// (WhatsApp, e-mail...). Se não for possível, baixa o arquivo.
async function share(i, tipo) {
  const r = reps[i];
  const nome = 'relatorio_' + (plan ? plan.projeto : 'mb').replace(/\W+/g, '_') + '.' + tipo;
  const arquivo = new File(
    [tipo == 'html' ? r.html : '\ufeff' + r.csv],   // \ufeff faz o Excel entender os acentos
    nome,
    { type: tipo == 'html' ? 'text/html' : 'text/csv' }
  );

  if (navigator.canShare && navigator.canShare({ files: [arquivo] })) {
    try {
      await navigator.share({ files: [arquivo], title: r.nome });
      return;
    } catch (e) {
      if (e.name === 'AbortError') return;   // usuário cancelou: não faz mais nada
    }
  }
  // Plano B: baixar o arquivo
  const link = document.createElement('a');
  link.href = URL.createObjectURL(arquivo);
  link.download = nome;
  link.click();
  alert('Arquivo baixado. Anexe-o no WhatsApp ou e-mail quando tiver internet.');
}


/* ============================================================
   INÍCIO: desenha a primeira tela ao abrir o app
   ============================================================ */
render();
