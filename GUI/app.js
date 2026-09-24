document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const shellTypeSelect = document.getElementById('shell-type');
  const runnerCmdSelect = document.getElementById('runner-cmd');
  const targetFolderInput = document.getElementById('target-folder');
  const flagForceInput = document.getElementById('flag-force');
  const flagOpenAICoverInput = document.getElementById('flag-openaicover');
  const flagRenameInput = document.getElementById('flag-rename');
  const flagInteractiveInput = document.getElementById('flag-interactive');
  const concurrencyRange = document.getElementById('concurrency-range');
  const concurrencyVal = document.getElementById('concurrency-val');
  const countrySelect = document.getElementById('country-select');
  const customCountryGroup = document.getElementById('custom-country-group');
  const customCountryInput = document.getElementById('custom-country-input');
  const countryExplicitCheck = document.getElementById('country-explicit');
  
  const keyOpenAI = document.getElementById('key-openai');
  const keyACRAccess = document.getElementById('key-acr-access');
  const keyACRSecret = document.getElementById('key-acr-secret');
  const keyACRHost = document.getElementById('key-acr-host');
  const keyAcoustID = document.getElementById('key-acoustid');
  const keyLastFm = document.getElementById('key-lastfm');

  const commandOutput = document.getElementById('command-output');
  const displayShellLabel = document.getElementById('display-shell-label');
  const cmdLength = document.getElementById('cmd-length');
  const btnCopy = document.getElementById('btn-copy');
  const toastMsg = document.getElementById('toast-msg');
  const btnReset = document.getElementById('btn-reset');
  const breakdownList = document.getElementById('breakdown-list');

  let styleMode = 'single'; // single | multiline
  let keyExportMode = 'env'; // env | cli

  const STORAGE_KEY = 'mp3_metadata_gui_config_v1';

  // Presets Data Mapping
  const PRESETS = {
    'full-auto': {
      mode: 'recognize',
      force: true,
      rename: true,
      interactive: false,
      concurrency: 3,
      target: './process'
    },
    'quick-force': {
      mode: 'standard',
      force: true,
      rename: false,
      interactive: false,
      concurrency: 3,
      target: './process'
    },
    'acr-acoustid': {
      mode: 'recognize',
      force: false,
      rename: true,
      interactive: false,
      concurrency: 3,
      target: './process'
    },
    'whisper': {
      mode: 'openai',
      force: true,
      rename: true,
      interactive: false,
      concurrency: 3,
      target: './process'
    },
    'dedup-move': {
      mode: 'dedup-move',
      force: false,
      rename: false,
      interactive: false,
      concurrency: 3,
      target: './process'
    },
    'interactive': {
      mode: 'standard',
      force: false,
      rename: false,
      interactive: true,
      concurrency: 3,
      target: './process'
    }
  };

  // Save state to localStorage
  function saveState() {
    const selectedRadio = document.querySelector('input[name="operation-mode"]:checked');
    const state = {
      shell: shellTypeSelect.value,
      runner: runnerCmdSelect.value,
      target: targetFolderInput.value,
      force: flagForceInput.checked,
      openaiCover: flagOpenAICoverInput ? flagOpenAICoverInput.checked : false,
      rename: flagRenameInput.checked,
      interactive: flagInteractiveInput.checked,
      concurrency: concurrencyRange.value,
      country: countrySelect ? countrySelect.value : 'US',
      customCountry: customCountryInput ? customCountryInput.value : '',
      countryExplicit: countryExplicitCheck ? countryExplicitCheck.checked : false,
      mode: selectedRadio ? selectedRadio.value : 'standard',
      styleMode,
      keyExportMode
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Could not save config to localStorage:', e);
    }
  }

  // Restore state from localStorage
  function restoreState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);

      if (state.shell) shellTypeSelect.value = state.shell;
      if (state.runner) runnerCmdSelect.value = state.runner;
      if (state.target !== undefined) targetFolderInput.value = state.target;
      if (state.force !== undefined) flagForceInput.checked = state.force;
      if (state.openaiCover !== undefined && flagOpenAICoverInput) flagOpenAICoverInput.checked = state.openaiCover;
      if (state.rename !== undefined) flagRenameInput.checked = state.rename;
      if (state.interactive !== undefined) flagInteractiveInput.checked = state.interactive;
      if (state.concurrency !== undefined) {
        concurrencyRange.value = state.concurrency;
        concurrencyVal.textContent = state.concurrency;
      }
      if (state.country !== undefined && countrySelect) {
        countrySelect.value = state.country;
        if (state.country === 'CUSTOM' && customCountryGroup) {
          customCountryGroup.classList.remove('hidden');
        } else if (customCountryGroup) {
          customCountryGroup.classList.add('hidden');
        }
      }
      if (state.customCountry !== undefined && customCountryInput) {
        customCountryInput.value = state.customCountry;
      }
      if (state.countryExplicit !== undefined && countryExplicitCheck) {
        countryExplicitCheck.checked = state.countryExplicit;
      }
      if (state.mode) {
        const radio = Array.from(document.querySelectorAll('input[name="operation-mode"]'))
          .find(option => option.value === state.mode);
        if (radio) {
          radio.checked = true;
          document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('active'));
          radio.closest('.radio-card').classList.add('active');
        }
      }
      
      if (state.styleMode) {
        styleMode = state.styleMode;
        document.querySelectorAll('.segmented-control button[data-style]').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-style') === styleMode);
        });
      }

      if (state.keyExportMode) {
        keyExportMode = state.keyExportMode;
        document.querySelectorAll('.segmented-control button[data-keymode]').forEach(b => {
          b.classList.toggle('active', b.getAttribute('data-keymode') === keyExportMode);
        });
      }
    } catch (e) {
      console.warn('Could not restore config from localStorage:', e);
    }
  }

  // Setup Event Listeners
  [shellTypeSelect, runnerCmdSelect, targetFolderInput, flagForceInput, flagOpenAICoverInput, flagRenameInput, 
   flagInteractiveInput, concurrencyRange, keyOpenAI, keyACRAccess, keyACRSecret, keyACRHost, keyAcoustID, keyLastFm]
    .forEach(el => {
      if (el) {
        el.addEventListener('input', updateGenerator);
        el.addEventListener('change', updateGenerator);
      }
    });

  if (countrySelect) {
    countrySelect.addEventListener('change', () => {
      if (countrySelect.value === 'CUSTOM') {
        customCountryGroup?.classList.remove('hidden');
        customCountryInput?.focus();
      } else {
        customCountryGroup?.classList.add('hidden');
      }
      updateGenerator();
    });
  }

  if (customCountryInput) {
    customCountryInput.addEventListener('input', () => {
      customCountryInput.value = customCountryInput.value.toUpperCase().replace(/[^A-Z]/g, '');
      updateGenerator();
    });
  }

  if (countryExplicitCheck) {
    countryExplicitCheck.addEventListener('change', updateGenerator);
  }

  // Radio cards for Operation Modes
  const radioCards = document.querySelectorAll('input[name="operation-mode"]');
  radioCards.forEach(radio => {
    radio.addEventListener('change', (e) => {
      document.querySelectorAll('.radio-card').forEach(card => card.classList.remove('active'));
      e.target.closest('.radio-card').classList.add('active');
      updateGenerator();
    });
  });

  // Concurrency Range Display
  concurrencyRange.addEventListener('input', (e) => {
    concurrencyVal.textContent = e.target.value;
    updateGenerator();
  });

  // Toggle Password Masking (Eye button)
  document.querySelectorAll('.btn-toggle-eye').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      const fieldLabel = input.labels?.[0]?.textContent.trim() || 'key';
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🙈';
        btn.setAttribute('aria-label', `Hide ${fieldLabel}`);
      } else {
        input.type = 'password';
        btn.textContent = '👁️';
        btn.setAttribute('aria-label', `Show ${fieldLabel}`);
      }
    });
  });

  // Segmented control: Style Mode
  document.querySelectorAll('.segmented-control button[data-style]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.segmented-control button[data-style]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      styleMode = e.target.getAttribute('data-style');
      updateGenerator();
    });
  });

  // Segmented control: Key Export Mode
  document.querySelectorAll('.segmented-control button[data-keymode]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.segmented-control button[data-keymode]').forEach(b => b.classList.remove('active'));
      e.target.classList.add('active');
      keyExportMode = e.target.getAttribute('data-keymode');
      updateGenerator();
    });
  });

  // Path Chip clicks
  document.querySelectorAll('.path-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      targetFolderInput.value = chip.getAttribute('data-path');
      updateGenerator();
    });
  });

  // Preset Buttons
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const presetKey = btn.getAttribute('data-preset');
      const config = PRESETS[presetKey];
      if (!config) return;

      // Set operation mode radio
      const radio = document.querySelector(`input[name="operation-mode"][value="${config.mode}"]`);
      if (radio) {
        radio.checked = true;
        document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('active'));
        radio.closest('.radio-card').classList.add('active');
      }

      flagForceInput.checked = config.force;
      flagRenameInput.checked = config.rename;
      flagInteractiveInput.checked = config.interactive;
      concurrencyRange.value = config.concurrency;
      concurrencyVal.textContent = config.concurrency;
      if (countrySelect) {
        countrySelect.value = 'US';
        customCountryInput.value = '';
        customCountryGroup?.classList.add('hidden');
      }
      if (countryExplicitCheck) countryExplicitCheck.checked = false;
      if (config.target) targetFolderInput.value = config.target;

      updateGenerator();
    });
  });

  // Reset Button
  btnReset.addEventListener('click', () => {
    localStorage.removeItem(STORAGE_KEY);

    shellTypeSelect.value = 'pwsh';
    runnerCmdSelect.value = 'node dist/index.js';
    targetFolderInput.value = './process';
    flagForceInput.checked = false;
    flagRenameInput.checked = false;
    flagInteractiveInput.checked = false;
    concurrencyRange.value = 3;
    concurrencyVal.textContent = '3';

    if (countrySelect) countrySelect.value = 'US';
    if (customCountryInput) customCountryInput.value = '';
    if (customCountryGroup) customCountryGroup.classList.add('hidden');
    if (countryExplicitCheck) countryExplicitCheck.checked = false;
    
    keyOpenAI.value = '';
    keyACRAccess.value = '';
    keyACRSecret.value = '';
    keyACRHost.value = '';
    keyAcoustID.value = '';
    keyLastFm.value = '';

    const defaultRadio = document.querySelector('input[name="operation-mode"][value="standard"]');
    defaultRadio.checked = true;
    document.querySelectorAll('.radio-card').forEach(c => c.classList.remove('active'));
    defaultRadio.closest('.radio-card').classList.add('active');

    updateGenerator();
  });

  // Copy to Clipboard
  btnCopy.addEventListener('click', () => {
    const textToCopy = commandOutput.textContent;
    navigator.clipboard.writeText(textToCopy).then(() => {
      toastMsg.classList.remove('hidden');
      setTimeout(() => {
        toastMsg.classList.add('hidden');
      }, 3000);
    }).catch(err => {
      console.error('Failed to copy text: ', err);
    });
  });

  // Helper to format environment variables based on shell
  function formatEnvVar(shell, name, val) {
    if (!val) return '';
    const cleanVal = val.replace(/"/g, '\\"');
    if (shell === 'pwsh') {
      return `$env:${name}="${cleanVal}"`;
    } else if (shell === 'cmd') {
      return `set ${name}=${cleanVal}`;
    } else {
      // bash / zsh
      return `${name}="${cleanVal}"`;
    }
  }

  // Main Generator Function
  function updateGenerator() {
    saveState();

    const shell = shellTypeSelect.value;
    const runner = runnerCmdSelect.value;
    let targetPath = targetFolderInput.value.trim() || './process';
    
    // Add quotes if path has spaces and isn't already quoted
    if (targetPath.includes(' ') && !targetPath.startsWith('"')) {
      targetPath = `"${targetPath}"`;
    }

    const force = flagForceInput.checked;
    const rename = flagRenameInput.checked;
    const interactive = flagInteractiveInput.checked;
    const concurrency = parseInt(concurrencyRange.value, 10);

    const selectedRadio = document.querySelector('input[name="operation-mode"]:checked');
    const mode = selectedRadio ? selectedRadio.value : 'standard';

    const openaiVal = keyOpenAI.value.trim();
    const acrAccessVal = keyACRAccess.value.trim();
    const acrSecretVal = keyACRSecret.value.trim();
    const acrHostVal = keyACRHost.value.trim();
    const acoustidVal = keyAcoustID.value.trim();
    const lastFmVal = keyLastFm.value.trim();

    const envVars = [];
    if (lastFmVal) envVars.push(formatEnvVar(shell, 'LASTFM_API_KEY', lastFmVal));
    const cliFlags = [];
    const breakdown = [];

    // Environment vs CLI Key Handling
    if (keyExportMode === 'env') {
      if (openaiVal) envVars.push(formatEnvVar(shell, 'OPENAI_API_KEY', openaiVal));
      if (acrAccessVal) envVars.push(formatEnvVar(shell, 'ACRCLOUD_ACCESS_KEY', acrAccessVal));
      if (acrSecretVal) envVars.push(formatEnvVar(shell, 'ACRCLOUD_ACCESS_SECRET', acrSecretVal));
      if (acrHostVal) envVars.push(formatEnvVar(shell, 'ACRCLOUD_HOST', acrHostVal));
      if (acoustidVal) envVars.push(formatEnvVar(shell, 'ACOUSTID_API_KEY', acoustidVal));
    } else {
      if (openaiVal) cliFlags.push(`--openai-key "${openaiVal}"`);
      if (acrAccessVal) cliFlags.push(`--acrcloud-key "${acrAccessVal}"`);
      if (acrSecretVal) cliFlags.push(`--acrcloud-secret "${acrSecretVal}"`);
      if (acoustidVal) cliFlags.push(`--acoustid-key "${acoustidVal}"`);
      if (acrHostVal) envVars.push(formatEnvVar(shell, 'ACRCLOUD_HOST', acrHostVal));
    }

    // Breakdown annotations
    const apiFlagCount = cliFlags.filter(f => f.includes('key') || f.includes('secret')).length;
    const credentialCount = envVars.length + apiFlagCount;
    if (credentialCount > 0) {
      breakdown.push({
        code: envVars.length && apiFlagCount
          ? 'Environment Keys & API Flags'
          : envVars.length
            ? 'Environment Keys'
            : 'API Flags',
        desc: `Configured ${credentialCount} API credentials`
      });
    }

    // Operation mode flag
    switch (mode) {
      case 'recognize':
        cliFlags.push('--recognize');
        breakdown.push({ code: '--recognize', desc: 'Audio fingerprint recognition (Shazam → ACRCloud → AcoustID)' });
        break;
      case 'openai':
        cliFlags.push('--openai-recon');
        breakdown.push({ code: '--openai-recon', desc: 'OpenAI Whisper audio lyric transcription' });
        break;
      case 'filename':
        cliFlags.push('--from-filename');
        breakdown.push({ code: '--from-filename', desc: 'Metadata & artwork search based on filename' });
        break;
      case 'dedup-log':
        cliFlags.push('--dedup-standalone-log');
        breakdown.push({ code: '--dedup-standalone-log', desc: 'Duplicate detection pass (log only)' });
        break;
      case 'dedup-move':
        cliFlags.push('--dedup-standalone-move');
        breakdown.push({ code: '--dedup-standalone-move', desc: 'Duplicate detection pass (moves duplicates to duplicates/ folder)' });
        break;
      case 'dedup-delete':
        cliFlags.push('--dedup-standalone-delete');
        breakdown.push({ code: '--dedup-standalone-delete', desc: 'Duplicate detection pass (permanently deletes duplicates)' });
        break;
      default:
        breakdown.push({ code: 'Standard Mode', desc: 'Reads ID3 tags & parses Title - Artist from filenames when missing, then fetches metadata & covers' });
    }

    // Modifiers
    if (force) {
      cliFlags.push('--force');
      breakdown.push({ code: '--force', desc: 'Re-process files even if artwork already exists' });
    }
    if (flagOpenAICoverInput && flagOpenAICoverInput.checked) {
      cliFlags.push('--use-openai-cover');
      breakdown.push({ code: '--use-openai-cover', desc: 'Use OpenAI web search to find & download album cover art' });
    }
    if (rename) {
      cliFlags.push('--rename');
      breakdown.push({ code: '--rename', desc: 'Auto-rename files to "Title - Artist.mp3"' });
    }
    if (interactive) {
      cliFlags.push('--interactive');
      breakdown.push({ code: '--interactive', desc: 'Launch terminal interactive prompt wizard' });
    }
    if (concurrency !== 3) {
      cliFlags.push(`--concurrency ${concurrency}`);
      breakdown.push({ code: `--concurrency ${concurrency}`, desc: `Process ${concurrency} files simultaneously` });
    }

    // iTunes Country Selector
    const rawCountry = countrySelect ? countrySelect.value : 'US';
    let countryCode = rawCountry;
    let countryLabel = 'United States';
    if (rawCountry === 'CUSTOM') {
      const customCode = (customCountryInput?.value || '').trim().toUpperCase();
      countryCode = customCode || 'US';
      countryLabel = `Custom (${countryCode})`;
    } else if (countrySelect?.selectedOptions?.[0]) {
      countryLabel = countrySelect.selectedOptions[0].text;
    }

    const isExplicitCountry = countryExplicitCheck?.checked;
    if (countryCode !== 'US' || isExplicitCountry) {
      cliFlags.push(`--country ${countryCode}`);
      breakdown.push({
        code: `--country ${countryCode}`,
        desc: `iTunes Store storefront (${countryLabel})`
      });
    } else {
      breakdown.push({
        code: 'US',
        desc: 'iTunes Store country: US (Default)'
      });
    }

    // Target folder
    breakdown.push({ code: targetPath, desc: 'Target directory to scan for MP3 files' });

    // Assemble Shell Command
    let fullCommand = '';
    let shellLabel = 'PowerShell';

    if (shell === 'pwsh') {
      shellLabel = 'PowerShell';
      if (styleMode === 'multiline') {
        const envBlock = envVars.length ? envVars.join('\n') + '\n' : '';
        const cliStr = [runner, ...cliFlags, targetPath].join(' ');
        fullCommand = envBlock + cliStr;
      } else {
        const envStr = envVars.length ? envVars.join('; ') + '; ' : '';
        const cliStr = [runner, ...cliFlags, targetPath].join(' ');
        fullCommand = `${envStr}${cliStr}`;
      }
    } else if (shell === 'cmd') {
      shellLabel = 'Windows CMD';
      if (styleMode === 'multiline') {
        const envBlock = envVars.length ? envVars.map(e => `${e}`).join('\n') + '\n' : '';
        const cliStr = [runner, ...cliFlags, targetPath].join(' ');
        fullCommand = envBlock + cliStr;
      } else {
        const envStr = envVars.length ? envVars.join(' && ') + ' && ' : '';
        const cliStr = [runner, ...cliFlags, targetPath].join(' ');
        fullCommand = `${envStr}${cliStr}`;
      }
    } else {
      // Bash / Zsh
      shellLabel = 'Bash / Zsh';
      if (styleMode === 'multiline') {
        const envBlock = envVars.length ? envVars.map(e => `export ${e}`).join('\n') + '\n' : '';
        const cliStr = [runner, ...cliFlags, targetPath].join(' ');
        fullCommand = envBlock + cliStr;
      } else {
        const envStr = envVars.length ? envVars.join(' ') + ' ' : '';
        const cliStr = [runner, ...cliFlags, targetPath].join(' ');
        fullCommand = `${envStr}${cliStr}`;
      }
    }

    // Render Output
    displayShellLabel.textContent = shellLabel;
    commandOutput.textContent = fullCommand;
    cmdLength.textContent = `${fullCommand.length} chars`;

    // Render Breakdown List
    breakdownList.replaceChildren(...breakdown.map(item => {
      const listItem = document.createElement('li');
      const code = document.createElement('code');
      const description = document.createElement('span');
      code.textContent = item.code;
      description.textContent = item.desc;
      listItem.append(code, description);
      return listItem;
    }));
  }

  // Restore state on load then update
  restoreState();
  updateGenerator();
});
