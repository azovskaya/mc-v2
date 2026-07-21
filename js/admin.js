/* Admin panel for Meal Kiosk v2 */
(() => {
  const SESSION_KEY = 'mc_v2_admin_ok';

  const state = {
    employees: [],
    meals: [],
    settings: {},
    cameraOn: false,
    selectedId: null
  };

  const $ = id => document.getElementById(id);

  function toast(msg, kind = '') {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.className = 'toast'; }, 2600);
  }

  function setStatus(id, text, kind = '') {
    const el = $(id);
    if (!el) return;
    el.textContent = text || '';
    el.className = 'status' + (kind ? ' ' + kind : '');
  }

  function show(view) {
    ['setupView', 'lockView', 'appView'].forEach(id => $(id).classList.remove('show'));
    $(view).classList.add('show');
  }

  function isAuthed() {
    return sessionStorage.getItem(SESSION_KEY) === '1';
  }

  function setAuthed(v) {
    if (v) sessionStorage.setItem(SESSION_KEY, '1');
    else sessionStorage.removeItem(SESSION_KEY);
  }

  async function refreshSettings() {
    const res = await apiGet('getSettings');
    state.settings = res.settings || {};
    return state.settings;
  }

  async function refreshEmployees() {
    const res = await apiGet('listEmployees');
    state.employees = res.items || [];
    renderEmployees();
  }

  async function refreshMeals() {
    const res = await apiGet('listMeals', { limit: 2000 });
    state.meals = res.items || [];
    renderMeals();
  }

  function renderEmployees() {
    const q = ($('empSearch').value || '').trim().toLowerCase();
    const rows = state.employees.filter(e => {
      if (!q) return true;
      return `${e.fullName} ${e.department} ${e.staffId}`.toLowerCase().includes(q);
    });
    $('empTable').innerHTML = rows.map(e => {
      const hasFace = !!parseFaceDescriptor(e.faceDescriptor);
      const src = (String(e.photoThumb || '').startsWith('data:image') && e.photoThumb) || photoUrl(e.photo);
      const avatar = src
        ? `<img class="thumb" src="${esc(src)}" alt="${esc(e.fullName)}" />`
        : `<div class="thumb thumb-empty">${esc((e.fullName || '?').trim().charAt(0).toUpperCase())}</div>`;
      const faceBadge = hasFace
        ? `<span class="face-dot" title="Face ID сохранён"></span>`
        : `<span class="face-dot off" title="Без Face ID"></span>`;
      return `<tr data-id="${esc(e.employeeId)}" style="cursor:pointer">
        <td><div class="avatar-cell">${avatar}${faceBadge}</div></td>
        <td><b>${esc(e.fullName)}</b><div class="hint">${esc(e.staffId || '')}</div></td>
        <td>${esc(e.department || '')}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="3">Пока никого нет</td></tr>`;

    $('empTable').querySelectorAll('tr[data-id]').forEach(tr => {
      tr.addEventListener('click', () => selectEmployee(tr.dataset.id));
    });
  }

  function selectEmployee(id) {
    const e = state.employees.find(x => String(x.employeeId) === String(id));
    if (!e) return;
    state.selectedId = e.employeeId;
    $('empId').value = e.employeeId;
    $('empName').value = e.fullName || '';
    $('empStaff').value = e.staffId || '';
    $('empDept').value = e.department || '';
    $('empPos').value = e.position || '';
    $('saveEmpBtn').textContent = 'Обновить с Face ID';
    $('cancelEditBtn').style.display = '';
    setStatus('empStatus', 'Редактирование: ' + e.fullName);
    startEmpCamera();
  }

  function clearEmployeeForm() {
    state.selectedId = null;
    $('empId').value = '';
    $('empName').value = '';
    $('empStaff').value = '';
    $('empDept').value = '';
    $('empPos').value = '';
    $('saveEmpBtn').textContent = 'Сохранить с Face ID';
    $('cancelEditBtn').style.display = 'none';
    setStatus('empStatus', '');
  }

  async function startEmpCamera() {
    try {
      await loadFaceModels('./models');
      if (!state.cameraOn) {
        await startCamera($('empVideo'));
        state.cameraOn = true;
      }
      $('camHint')?.classList.add('hidden');
    } catch (e) {
      const h = $('camHint');
      if (h) { h.classList.remove('hidden'); h.textContent = 'Нет доступа к камере'; }
    }
  }

  function mealDate(m) {
    const d = String(m.date || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    if (m.timestamp) {
      try {
        return new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
          .format(new Date(m.timestamp));
      } catch {}
    }
    return '';
  }

  function filteredMeals() {
    const from = $('fFrom').value;
    const to = $('fTo').value;
    const type = $('fType').value;
    return state.meals.filter(m => {
      const d = mealDate(m);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (type && m.mealType !== type) return false;
      return true;
    });
  }

  function renderMeals() {
    const items = filteredMeals();
    const sum = items.reduce((a, m) => a + (Number(m.price) || 0), 0);
    const byType = { 'Завтрак': 0, 'Обед': 0, 'Ужин': 0, 'Специальное': 0 };
    items.forEach(m => { if (byType[m.mealType] !== undefined) byType[m.mealType]++; });

    $('stats').innerHTML = `
      <div class="stat"><b>${items.length}</b><span>записей</span></div>
      <div class="stat"><b>${byType['Обед']}</b><span>обедов</span></div>
      <div class="stat"><b>${byType['Специальное']}</b><span>спец.</span></div>
      <div class="stat"><b>${fmtMoney(sum)}</b><span>сумма</span></div>
    `;

    $('mealTable').innerHTML = items.slice(0, 400).map(m => {
      const cls = m.mealType === 'Специальное' ? 'badge special' : 'badge';
      return `<tr>
        <td>${esc(mealDate(m))} ${esc(String(m.time || '').slice(0, 8))}</td>
        <td>${esc(m.employeeName)}<div class="hint">${esc(m.department || '')}</div></td>
        <td><span class="${cls}">${esc(m.mealType)}</span></td>
        <td>${fmtMoney(m.price)}</td>
        <td>${esc(m.note || '')}</td>
      </tr>`;
    }).join('') || `<tr><td colspan="5">Нет записей</td></tr>`;
  }

  function fillSettingsForm() {
    const s = state.settings;
    $('appTitle').textContent = s.siteName || 'Admin Panel';
    $('appSub').textContent = s.operator ? `Ответственный: ${s.operator}` : 'Управление точкой питания';
    $('setSite').value = s.siteName || '';
    $('setOperator').value = s.operator || '';
    $('setBr').value = s.priceBr || '';
    $('setLu').value = s.priceLu || '';
    $('setDi').value = s.priceDi || '';
    $('setApi').value = getApiUrl();
    const origin = location.origin + location.pathname.replace(/admin\.html.*/, '');
    $('kioskLink').textContent = origin + (origin.endsWith('/') ? '' : '/') + 'index.html';
  }

  async function ensureModelsAndCam() {
    await loadFaceModels('./models');
    if (!state.cameraOn) {
      await startCamera($('empVideo'));
      state.cameraOn = true;
    }
  }

  let _savingEmp = false;

  async function saveEmployee() {
    if (_savingEmp) return;
    const fullName = $('empName').value.trim();
    if (!fullName) return setStatus('empStatus', 'Укажите ФИО', 'err');

    const btn = $('saveEmpBtn');
    _savingEmp = true;
    btn.disabled = true;
    const origText = btn.textContent;

    const step = t => {
      btn.textContent = t;
      setStatus('empStatus', t);
    };

    try {
      step('Камера…');
      $('camHint')?.classList.add('hidden');
      await ensureModelsAndCam();

      // Сначала кадр (Safari надёжнее, пока видео только что играет), потом Face ID
      step('Фото…');
      const photo = await captureFrame($('empVideo'), 420, 0.6);
      const photoThumb = await captureFrame($('empVideo'), 160, 0.55);
      if (!isValidPhotoDataUrl(photoThumb) && !isValidPhotoDataUrl(photo)) {
        setStatus('empStatus', 'Не удалось снять фото. Убедитесь, что в окошке видно ваше лицо, и нажмите ещё раз.', 'err');
        return;
      }
      const thumb = isValidPhotoDataUrl(photoThumb) ? photoThumb : photo;
      const full = isValidPhotoDataUrl(photo) ? photo : photoThumb;

      step('Сканирование лица…');
      const desc = await computeDescriptorFromVideo($('empVideo'));
      if (!desc) {
        setStatus('empStatus', 'Лицо не найдено — встаньте ровнее к камере', 'err');
        return;
      }

      // Проверка на дубликат: то же лицо уже у другого сотрудника?
      const editingId = $('empId').value || null;
      const dup = findDuplicateByFace(desc, editingId);
      if (dup) {
        setStatus('empStatus', `Это лицо уже зарегистрировано: ${dup.fullName}`, 'err');
        toast('Такой сотрудник уже есть', 'err');
        return;
      }
      // Проверка по имени (без учёта регистра), если добавляем нового
      if (!editingId) {
        const sameName = state.employees.find(
          e => (e.fullName || '').trim().toLowerCase() === fullName.toLowerCase()
        );
        if (sameName) {
          setStatus('empStatus', `Сотрудник «${fullName}» уже есть в списке`, 'err');
          return;
        }
      }

      step('Сохранение…');
      const res = await apiPost('saveEmployee', {
        employeeId: editingId || undefined,
        fullName,
        staffId: $('empStaff').value.trim(),
        department: $('empDept').value.trim(),
        position: $('empPos').value.trim(),
        faceDescriptor: desc.join(','),
        photo: full,
        photoThumb: thumb,
        active: true
      });
      if (!res.ok) {
        setStatus('empStatus', res.message || 'Ошибка', 'err');
        return;
      }
      // Мгновенно показываем в списке даже до перезагрузки с сервера
      if (res.employee) {
        res.employee.photoThumb = res.employee.photoThumb || thumb;
      }
      toast(editingId ? 'Сотрудник обновлён' : 'Сотрудник добавлен');
      await refreshEmployees();
      clearEmployeeForm();
      setStatus('empStatus', `Готово: ${fullName}. Можно добавлять следующего.`, 'ok');
    } catch (err) {
      setStatus('empStatus', String(err.message || err), 'err');
    } finally {
      _savingEmp = false;
      btn.disabled = false;
      btn.textContent = state.selectedId ? 'Обновить с Face ID' : origText;
    }
  }

  function faceDistance(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) {
      const d = a[i] - b[i];
      s += d * d;
    }
    return Math.sqrt(s);
  }

  function findDuplicateByFace(desc, exceptId) {
    const target = Float32Array.from(desc);
    for (const e of state.employees) {
      if (exceptId && String(e.employeeId) === String(exceptId)) continue;
      const d = parseFaceDescriptor(e.faceDescriptor);
      if (!d) continue;
      if (faceDistance(target, d) < 0.45) return e;
    }
    return null;
  }

  function exportCsv() {
    const items = filteredMeals();
    const header = ['date', 'time', 'employeeName', 'department', 'mealType', 'price', 'note'];
    const lines = [header.join(';')];
    items.forEach(m => {
      lines.push([
        mealDate(m), m.time, m.employeeName, m.department, m.mealType, m.price, m.note
      ].map(v => {
        const s = String(v ?? '');
        return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(';'));
    });
    const blob = new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `meals_${todayInTz()}.csv`;
    a.click();
  }

  function bindTabs() {
    $('tabs').querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', () => {
        $('tabs').querySelectorAll('button').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.panel').forEach(p => p.classList.remove('show'));
        $('tab-' + btn.dataset.tab).classList.add('show');
        if (btn.dataset.tab === 'employees') {
          startEmpCamera();
        } else {
          stopCamera($('empVideo'));
          state.cameraOn = false;
        }
      });
    });
  }

  function bindEvents() {
    bindTabs();

    $('wizPingBtn').addEventListener('click', async () => {
      const url = $('wizApi').value.trim();
      if (!url) return setStatus('wizStatus', 'Вставьте URL', 'err');
      setApiUrl(url);
      try {
        const r = await apiGet('ping');
        setStatus('wizStatus', r.ok ? `Связь ОК (${r.version || 'ok'})` : (r.message || 'Ошибка'), r.ok ? 'ok' : 'err');
      } catch (e) {
        setStatus('wizStatus', String(e.message || e), 'err');
      }
    });

    $('wizSaveBtn').addEventListener('click', async () => {
      const api = $('wizApi').value.trim();
      const site = $('wizSite').value.trim();
      const pin = $('wizPin').value.trim();
      if (!api) return setStatus('wizStatus', 'Нужен URL', 'err');
      if (!site) return setStatus('wizStatus', 'Укажите название', 'err');
      if (!/^\d{4,8}$/.test(pin)) return setStatus('wizStatus', 'PIN: 4–8 цифр', 'err');

      setApiUrl(api);
      setStatus('wizStatus', 'Сохранение…');
      try {
        const ping = await apiGet('ping');
        if (!ping.ok) throw new Error(ping.message || 'Нет связи');

        // Сервер уже настроен другим устройством — не пересоздаём,
        // а входим по существующему PIN.
        const cur = (await apiGet('getSettings')).settings || {};
        if (cur.hasPin) {
          const verify = await apiPost('verifyPin', { pin });
          if (!verify.ok) {
            setStatus('wizStatus', 'Это заведение уже настроено. Неверный PIN.', 'err');
            return;
          }
          saveLocal({ siteName: cur.siteName || site, operator: cur.operator || '', setupDone: true });
          setAuthed(true);
          setStatus('wizStatus', 'Вход выполнен', 'ok');
          await enterApp();
          return;
        }

        const pinRes = await apiPost('setPin', { newPin: pin });
        if (!pinRes.ok) throw new Error(pinRes.message || 'PIN не сохранён');

        const save = await apiPost('saveSettings', {
          siteName: site,
          operator: $('wizOperator').value.trim(),
          priceBr: $('wizBr').value,
          priceLu: $('wizLu').value,
          priceDi: $('wizDi').value,
          setupDone: 'true',
          pin
        });
        if (!save.ok) throw new Error(save.message || 'Настройки не сохранены');

        saveLocal({ siteName: site, operator: $('wizOperator').value.trim(), setupDone: true });
        setAuthed(true);
        setStatus('wizStatus', 'Готово', 'ok');
        await enterApp();
      } catch (e) {
        setStatus('wizStatus', String(e.message || e), 'err');
      }
    });

    $('lockBtn').addEventListener('click', async () => {
      const pin = $('lockPin').value.trim();
      if (!pin) return setStatus('lockStatus', 'Введите PIN', 'err');
      try {
        const r = await apiPost('verifyPin', { pin });
        if (!r.ok) {
          setStatus('lockStatus', r.message || 'Неверный PIN', 'err');
          return;
        }
        setAuthed(true);
        await enterApp();
      } catch (e) {
        setStatus('lockStatus', String(e.message || e), 'err');
      }
    });

    $('lockPin').addEventListener('keydown', e => {
      if (e.key === 'Enter') $('lockBtn').click();
    });

    $('logoutBtn').addEventListener('click', () => {
      setAuthed(false);
      show('lockView');
    });

    $('cancelEditBtn').addEventListener('click', clearEmployeeForm);
    $('saveEmpBtn').addEventListener('click', saveEmployee);
    $('empSearch').addEventListener('input', renderEmployees);

    $('refreshMealsBtn').addEventListener('click', () => refreshMeals().catch(e => toast(String(e.message || e), 'err')));
    ['fFrom', 'fTo', 'fType'].forEach(id => $(id).addEventListener('change', renderMeals));
    $('exportCsvBtn').addEventListener('click', exportCsv);

    $('saveSettingsBtn').addEventListener('click', async () => {
      const pin = $('setPinConfirm').value.trim();
      if (!pin) return setStatus('setStatus', 'Введите текущий PIN', 'err');
      try {
        const r = await apiPost('saveSettings', {
          pin,
          siteName: $('setSite').value.trim(),
          operator: $('setOperator').value.trim(),
          priceBr: $('setBr').value,
          priceLu: $('setLu').value,
          priceDi: $('setDi').value
        });
        if (!r.ok) return setStatus('setStatus', r.message || 'Ошибка', 'err');
        state.settings = r.settings || state.settings;
        fillSettingsForm();
        setStatus('setStatus', 'Сохранено на сервере', 'ok');
        toast('Настройки обновлены');
      } catch (e) {
        setStatus('setStatus', String(e.message || e), 'err');
      }
    });

    $('changePinBtn').addEventListener('click', async () => {
      try {
        const r = await apiPost('setPin', {
          currentPin: $('pinOld').value.trim(),
          newPin: $('pinNew').value.trim()
        });
        if (!r.ok) return setStatus('pinStatus', r.message || 'Ошибка', 'err');
        $('pinOld').value = '';
        $('pinNew').value = '';
        setStatus('pinStatus', 'PIN обновлён', 'ok');
      } catch (e) {
        setStatus('pinStatus', String(e.message || e), 'err');
      }
    });

    $('saveApiBtn').addEventListener('click', () => {
      setApiUrl($('setApi').value.trim());
      setStatus('apiStatus', 'URL сохранён локально', 'ok');
    });

    $('pingBtn').addEventListener('click', async () => {
      setApiUrl($('setApi').value.trim());
      try {
        const r = await apiGet('ping');
        setStatus('apiStatus', r.ok ? `OK · v${r.version || '?'}` : (r.message || 'fail'), r.ok ? 'ok' : 'err');
      } catch (e) {
        setStatus('apiStatus', String(e.message || e), 'err');
      }
    });
  }

  async function enterApp() {
    show('appView');
    await refreshSettings();
    fillSettingsForm();
    const today = todayInTz();
    $('fFrom').value = today;
    $('fTo').value = today;
    await Promise.all([refreshEmployees(), refreshMeals()]);
    startEmpCamera();
  }

  async function boot() {
    bindEvents();

    const api = getApiUrl();
    if (!api) {
      show('setupView');
      return;
    }

    try {
      const s = await refreshSettings();
      // Без заданного PIN войти нельзя — всегда показываем мастер,
      // чтобы после сброса pinHash можно было настроить заново.
      if (!s.hasPin) {
        $('wizApi').value = api;
        if (s.siteName) $('wizSite').value = s.siteName;
        if (s.operator) $('wizOperator').value = s.operator;
        show('setupView');
        return;
      }
      if (isAuthed()) await enterApp();
      else show('lockView');
    } catch (e) {
      // URL битый — снова мастер
      $('wizApi').value = api;
      setStatus('wizStatus', String(e.message || e), 'err');
      show('setupView');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
