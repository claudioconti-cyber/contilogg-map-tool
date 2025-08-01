const express = require('express');
const path = require('path');
const fs = require('fs');
const mapper = require('./funcoes/mapear');   // mantém seu caminho atual

const app = express();
app.use(express.json());
app.use(express.static(__dirname));

const MAP_DIR = path.join(__dirname, 'mapas');

// Garante a pasta de mapas
fs.mkdirSync(MAP_DIR, { recursive: true });

let running = false;

/* ===================== ROTAS DO MAPEAMENTO ===================== */

app.post('/mapear', async (req, res) => {
    if (running) return res.status(409).json({ erro: 'Já rodando' });

    const { url, nomeArquivo, modo } = req.body;
    if (!url || !nomeArquivo || !modo) {
        return res.status(400).json({ erro: 'Parâmetros insuficientes' });
    }

    try {
        const outPath = path.join(MAP_DIR, `mapa_${nomeArquivo}.json`);
        await mapper.start(url, outPath, modo);
        running = true;
        res.json({ mensagem: 'Mapeamento iniciado. Use /stop para finalizar.' });
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

app.post('/stop', async (_req, res) => {
    if (!running) return res.status(409).json({ erro: 'Nada em execução' });

    try {
        await mapper.stop();
        running = false;
        res.json({ mensagem: 'Mapeamento finalizado.' });
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

/* ===================== ROTAS DE LISTA / EDIÇÃO DE MAPAS ===================== */

// Lista os mapas disponíveis (apenas nomes de arquivo)
app.get('/mapas', async (_req, res) => {
    try {
        const files = await fs.promises.readdir(MAP_DIR);
        const jsons = files.filter(f => f.toLowerCase().endsWith('.json')).sort();
        res.json({ mapas: jsons });
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// Retorna o conteúdo de um mapa específico
app.get('/mapas/:nome', async (req, res) => {
    try {
        const nomeSeguro = path.basename(req.params.nome);
        if (!nomeSeguro.toLowerCase().endsWith('.json')) {
            return res.status(400).json({ erro: 'Arquivo inválido' });
        }
        const full = path.join(MAP_DIR, nomeSeguro);
        if (!fs.existsSync(full)) return res.status(404).json({ erro: 'Mapa não encontrado' });

        const raw = await fs.promises.readFile(full, 'utf8');
        const json = JSON.parse(raw);
        res.json(json);
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

// Atualiza os "keys" de steps de um mapa
// Espera body: { mapping: { "oldKey": "newKey", ... } }
app.post('/mapas/:nome/keys', async (req, res) => {
    try {
        const nomeSeguro = path.basename(req.params.nome);
        if (!nomeSeguro.toLowerCase().endsWith('.json')) {
            return res.status(400).json({ erro: 'Arquivo inválido' });
        }
        const full = path.join(MAP_DIR, nomeSeguro);
        if (!fs.existsSync(full)) return res.status(404).json({ erro: 'Mapa não encontrado' });

        const { mapping } = req.body || {};
        if (!mapping || typeof mapping !== 'object') {
            return res.status(400).json({ erro: 'Envie "mapping" como objeto { oldKey: newKey }' });
        }

        const raw = await fs.promises.readFile(full, 'utf8');
        const mapa = JSON.parse(raw);

        if (Array.isArray(mapa.steps)) {
            for (const step of mapa.steps) {
                if (step && typeof step === 'object' && typeof step.key === 'string') {
                    const oldK = step.key;
                    if (Object.prototype.hasOwnProperty.call(mapping, oldK)) {
                        const newK = mapping[oldK];
                        if (typeof newK === 'string' && newK.trim() !== '') {
                            step.key = newK;
                        }
                    }
                }
            }
        }

        await fs.promises.writeFile(full, JSON.stringify(mapa, null, 2), 'utf8');
        res.json({ ok: true, mensagem: 'Keys atualizadas com sucesso.', mapaAtualizado: mapa });
    } catch (e) {
        res.status(500).json({ erro: e.message });
    }
});

app.listen(3000, () => console.log('Servidor em http://localhost:3000'));
