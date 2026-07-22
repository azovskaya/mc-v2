/* Kiosk UI logic */
(() => {
  const state = {
    employees: [],
    settings: {},
    current: null,
    matchScore: null,
    busy: false
  };

  const els = {
    video: document.getElementById('video'),
    facePill: document.getElementById('facePill'),
    scanRing: document.getElementById('scanRing'),
    siteLabel: document.getElementById('siteLabel'),
    brandTitle: document.getElementById('brandTitle'),
    overlay: document.getElementById('choiceOverlay'),
    choiceMain: document.getElementById('choiceMain'),
    whoName: document.getElementById('whoName'),
    specialPanel: document.getElementById('specialPanel'),
    specialWho: document.getElementById('specialWho'),
    specialNote: document.getElementById('specialNote'),
    specialPrice: document.getElementById('specialPrice'),
    successPanel: document.getElementById('successPanel'),
    successDetail: document.getElementById('successDetail'),
    toast: document.getElementById('toast')
  };

  function setPill(text, kind = '') {
    els.facePill.textContent = text;
    els.facePill.className = 'face-pill' + (kind ? ' ' + kind : '');
  }

  function toast(text, kind = '') {
    els.toast.textContent = text;
    els.toast.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { els.toast.className = 'toast'; }, 2800);
  }

  function showChoice(emp) {
    state.current = emp;
    els.whoName.textContent = emp.fullName || 'Сотрудник';
    els.specialWho.textContent = emp.fullName || '';
    els.choiceMain.style.display = '';
    els.specialPanel.classList.remove('show');
    els.successPanel.classList.remove('show');
    els.overlay.classList.add('show');
    els.scanRing.classList.add('ok');
  }

  function hideChoice() {
    els.overlay.classList.remove('show');
    els.scanRing.classList.remove('ok');
    state.current = null;
    state.matchScore = null;
  }

  async function resumeScan() {
    hideChoice();
    setPill('Подойдите к камере');
    startFaceScan(els.video, state.employees, {
      onStatus: (t, k) => setPill(t, k || ''),
      onMatch: async ({ employee, distance }) => {
        state.matchScore = Math.round((1 - distance) * 1000) / 1000;
        setPill(employee.fullName, 'ok');
        showChoice(employee);
      }
    });
  }

  async function registerMeal(mealType, { note = '', price = '' } = {}) {
    if (state.busy || !state.current) return;
    state.busy = true;
    document.querySelectorAll('.meal-btn, #specialSaveBtn').forEach(b => b.disabled = true);

    const emp = state.current;
    const local = loadLocal();
    try {
      const res = await apiPost('saveMeal', {
        mealId: genId(),
        employeeId: emp.employeeId,
        employeeName: emp.fullName,
        staffId: emp.staffId || '',
        department: emp.department || '',
        mealType,
        note,
        price,
        siteName: state.settings.siteName || local.siteName || '',
        operator: state.settings.operator || local.operator || '',
        matchScore: state.matchScore,
        verified: true
      });

      if (!res.ok) {
        toast(res.message || 'Не удалось записать', 'err');
        state.busy = false;
        document.querySelectorAll('.meal-btn, #specialSaveBtn').forEach(b => b.disabled = false);
        return;
      }

      els.choiceMain.style.display = 'none';
      els.specialPanel.classList.remove('show');
      const priceTxt = res.meal?.price !== '' && res.meal?.price != null
        ? ` · ${fmtMoney(res.meal.price)}`
        : '';
      const noteTxt = note ? ` — ${note}` : '';
      els.successDetail.textContent = `${mealType}${noteTxt}${priceTxt}`;
      els.successPanel.classList.add('show');

      setTimeout(() => {
        state.busy = false;
        document.querySelectorAll('.meal-btn, #specialSaveBtn').forEach(b => b.disabled = false);
        els.specialNote.value = '';
        els.specialPrice.value = '';
        resumeScan();
      }, 2200);
    } catch (err) {
      toast(String(err.message || err), 'err');
      state.busy = false;
      document.querySelectorAll('.meal-btn, #specialSaveBtn').forEach(b => b.disabled = false);
    }
  }

  function bindUi() {
    document.querySelectorAll('.meal-btn[data-meal]').forEach(btn => {
      btn.addEventListener('click', () => registerMeal(btn.dataset.meal));
    });

    document.getElementById('specialOpenBtn').addEventListener('click', () => {
      els.choiceMain.style.display = 'none';
      els.specialPanel.classList.add('show');
      els.specialNote.focus();
    });

    document.getElementById('specialBackBtn').addEventListener('click', () => {
      els.specialPanel.classList.remove('show');
      els.choiceMain.style.display = '';
    });

    document.getElementById('specialSaveBtn').addEventListener('click', () => {
      const note = els.specialNote.value.trim();
      const price = els.specialPrice.value.trim();
      if (!note) return toast('Напишите, что приготовили', 'err');
      if (price === '' || Number(price) < 0) return toast('Укажите цену', 'err');
      registerMeal('Специальное', { note, price: Number(price) });
    });

    document.getElementById('cancelChoiceBtn').addEventListener('click', () => {
      if (state.busy) return;
      resumeScan();
    });
  }

  async function boot() {
    bindUi();

    if (!getApiUrl()) {
      setPill('Сначала укажите URL в js/config.js', 'err');
      els.siteLabel.textContent = 'Нет URL сервера';
      toast('Пропишите apiUrl в js/config.js или откройте админку', 'err');
      return;
    }

    // Закрепляем URL из config.js локально
    if (!loadLocal().apiUrl && getConfiguredApiUrl()) setApiUrl(getConfiguredApiUrl());

    try {
      setPill('Подключение…');
      const ping = await apiGet('ping');
      if (!ping.ok) throw new Error(ping.message || 'Нет ответа сервера');

      const [empRes, setRes] = await Promise.all([
        apiGet('listEmployees'),
        apiGet('getSettings')
      ]);
      state.employees = empRes.items || [];
      state.settings = setRes.settings || {};

      if (state.settings.siteName) {
        els.brandTitle.textContent = state.settings.siteName;
        els.siteLabel.textContent = 'Подойдите к камере';
        saveLocal({ siteName: state.settings.siteName, operator: state.settings.operator || '' });
      }

      setPill('Загрузка моделей…');
      await loadFaceModels('./models');
      await startCamera(els.video);
      await resumeScan();
    } catch (err) {
      console.error(err);
      setPill(String(err.message || err), 'err');
      toast(String(err.message || err), 'err');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
