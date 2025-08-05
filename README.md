# Contilogg Mapeador Playwright

Ferramenta para **gravar** e **editar** interações em páginas web usando Playwright, gerando “mapas” JSON que depois podem ser executados automaticamente.

---

## 🔍 Descrição

O **Mapeador** permite:

1. **Gravar** cliques, preenchimentos, pressionamentos de Enter e uploads em um navegador Chromium.
2. **Gerar** um JSON (`mapa_<nome>.json`) contendo:
   - `modo`: `"consultar"` ou `"inserir"`.
   - `login`: seletores de login.
   - `steps`: sequência de ações.
   - `logout`: seletor de logout (último clique).
3. **Editar** esse JSON via UI web:
   - Alinhar as `key` mapeadas com seu arquivo de dados local.
   - Renomear `steps[].key` para combinar com o seu JSON de dados.
4. **Salvar** de volta em `src/mapas/`.

---

## 📦 Requisitos

- Node.js ≥ 16  
- npm  
- Windows/macOS/Linux  
- (Opcional, no Windows) PowerShell para o `start-app.bat`

---

## 💾 Instalação

1. Clone ou copie este diretório:
   ```bash
   git clone <url-do-repo>
   cd contilogg
