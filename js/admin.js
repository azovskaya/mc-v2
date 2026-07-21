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
    const res = await apiGet('listMeals', { limit: 5000 });
    state.meals = res.items || [];
    renderMeals();
    if ($('tab-reports')?.classList.contains('show')) renderReport();
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

  let _startingCam = false;

  function hideCamHint() { $('camHint')?.classList.add('hidden'); }
  function showCamHint(text) {
    const h = $('camHint');
    if (h) { h.textContent = text; h.classList.remove('hidden'); }
  }

  async function startEmpCamera() {
    if (_startingCam) return;
    const video = $('empVideo');
    // Если камера уже реально показывает картинку — просто прячем подсказку
    if (video && video.videoWidth > 0 && !video.paused) {
      state.cameraOn = true;
      hideCamHint();
      return;
    }
    _startingCam = true;
    try {
      await loadFaceModels('./models');
      if (!state.cameraOn || !video.videoWidth) {
        await startCamera(video);
        state.cameraOn = true;
      }
      // Прячем подсказку только когда пошёл реальный кадр
      if (await waitForVideoReady(video, 5000)) hideCamHint();
      else showCamHint('Камера включается…');
    } catch (e) {
      state.cameraOn = false;
      const msg = (e && /denied|not allowed|permission/i.test(String(e.message || e)))
        ? 'Разрешите доступ к камере в браузере'
        : 'Нет доступа к камере';
      showCamHint(msg);
    } finally {
      _startingCam = false;
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

  /* ─── Отчёты для бухгалтерии ─── */

  const MEAL_TYPES = ['Завтрак', 'Обед', 'Ужин', 'Специальное'];

  function reportFilteredMeals() {
    const from = $('rFrom').value;
    const to = $('rTo').value;
    const emp = $('rEmployee').value;
    const dept = $('rDepartment').value;
    return state.meals.filter(m => {
      const d = mealDate(m);
      if (from && d < from) return false;
      if (to && d > to) return false;
      if (emp && String(m.employeeId) !== String(emp)) return false;
      if (dept && (m.department || '') !== dept) return false;
      return true;
    });
  }

  function buildReportSummary(items) {
    const map = new Map();
    for (const m of items) {
      const key = m.employeeId || m.employeeName || '—';
      if (!map.has(key)) {
        map.set(key, {
          employeeId: m.employeeId || '',
          fullName: m.employeeName || '—',
          staffId: m.staffId || '',
          department: m.department || '',
          counts: { 'Завтрак': 0, 'Обед': 0, 'Ужин': 0, 'Специальное': 0 },
          total: 0,
          sum: 0
        });
      }
      const row = map.get(key);
      if (row.counts[m.mealType] !== undefined) row.counts[m.mealType]++;
      row.total++;
      row.sum += Number(m.price) || 0;
      if (!row.staffId && m.staffId) row.staffId = m.staffId;
      if (!row.department && m.department) row.department = m.department;
    }
    return [...map.values()].sort((a, b) => a.fullName.localeCompare(b.fullName, 'ru'));
  }

  function fillReportFilterOptions() {
    const empSel = $('rEmployee');
    const deptSel = $('rDepartment');
    const curEmp = empSel.value;
    const curDept = deptSel.value;

    const employees = [...state.employees].sort((a, b) =>
      (a.fullName || '').localeCompare(b.fullName || '', 'ru'));
    empSel.innerHTML = '<option value="">Все сотрудники</option>' +
      employees.map(e => `<option value="${esc(e.employeeId)}">${esc(e.fullName)}</option>`).join('');
    empSel.value = curEmp;

    const depts = [...new Set(state.employees.map(e => e.department).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ru'));
    deptSel.innerHTML = '<option value="">Все отделы</option>' +
      depts.map(d => `<option value="${esc(d)}">${esc(d)}</option>`).join('');
    deptSel.value = curDept;
  }

  function renderReport() {
    const items = reportFilteredMeals();
    const summary = buildReportSummary(items);
    const totalSum = summary.reduce((a, r) => a + r.sum, 0);
    const totalCount = items.length;
    const people = summary.length;
    const special = items.filter(m => m.mealType === 'Специальное').length;

    $('reportStats').innerHTML = `
      <div class="stat"><b>${people}</b><span>сотрудников</span></div>
      <div class="stat"><b>${totalCount}</b><span>приёмов пищи</span></div>
      <div class="stat"><b>${special}</b><span>спец. блюд</span></div>
      <div class="stat"><b>${fmtMoney(totalSum)}</b><span>к удержанию</span></div>
    `;

    $('reportSummaryTable').innerHTML = (summary.map(r => `
      <tr>
        <td><b>${esc(r.fullName)}</b></td>
        <td>${esc(r.staffId)}</td>
        <td>${esc(r.department)}</td>
        <td class="num">${r.counts['Завтрак']}</td>
        <td class="num">${r.counts['Обед']}</td>
        <td class="num">${r.counts['Ужин']}</td>
        <td class="num">${r.counts['Специальное']}</td>
        <td class="num">${r.total}</td>
        <td class="num">${fmtMoney(r.sum)}</td>
      </tr>`).join('') || `<tr><td colspan="9">Нет данных за период</td></tr>`) +
      (summary.length ? `<tr class="report-total">
        <td colspan="7">Итого</td>
        <td class="num">${totalCount}</td>
        <td class="num">${fmtMoney(totalSum)}</td>
      </tr>` : '');

    const details = [...items].sort((a, b) =>
      String(a.timestamp || '').localeCompare(String(b.timestamp || '')));
    $('reportDetailsTable').innerHTML = details.slice(0, 1000).map(m => `
      <tr>
        <td>${esc(mealDate(m))}</td>
        <td>${esc(String(m.time || '').slice(0, 8))}</td>
        <td>${esc(m.employeeName)}</td>
        <td>${esc(m.staffId || '')}</td>
        <td>${esc(m.department || '')}</td>
        <td>${esc(m.mealType)}</td>
        <td>${esc(m.note || '')}</td>
        <td class="num">${fmtMoney(m.price)}</td>
      </tr>`).join('') || `<tr><td colspan="8">Нет записей</td></tr>`;

    const periodTxt = ($('rFrom').value || '…') + ' — ' + ($('rTo').value || '…');
    setStatus('reportStatus', `Период: ${periodTxt}. Записей: ${totalCount}.`);
  }

  function periodLabel() {
    const f = $('rFrom').value || 'all';
    const t = $('rTo').value || 'all';
    return `${f}_${t}`;
  }

  function exportReportXlsx() {
    if (typeof XLSX === 'undefined') {
      toast('Библиотека Excel ещё грузится, повторите', 'err');
      return;
    }
    const items = reportFilteredMeals();
    if (!items.length) return toast('Нет данных за период', 'err');

    const summary = buildReportSummary(items);
    const site = state.settings.siteName || '';
    const periodTxt = ($('rFrom').value || '—') + ' — ' + ($('rTo').value || '—');

    const wb = XLSX.utils.book_new();

    const sumAoa = [
      [`Отчёт по питанию${site ? ' — ' + site : ''}`],
      [`Период: ${periodTxt}`],
      [],
      ['Сотрудник', 'Табельный №', 'Отдел', 'Завтраки', 'Обеды', 'Ужины', 'Другие', 'Всего', 'К удержанию, ₸']
    ];
    summary.forEach(r => sumAoa.push([
      r.fullName, r.staffId, r.department,
      r.counts['Завтрак'], r.counts['Обед'], r.counts['Ужин'], r.counts['Специальное'],
      r.total, r.sum
    ]));
    sumAoa.push([
      'ИТОГО', '', '', '', '', '', '',
      items.length, summary.reduce((a, r) => a + r.sum, 0)
    ]);
    const wsSum = XLSX.utils.aoa_to_sheet(sumAoa);
    wsSum['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(wb, wsSum, 'Сводка');

    const detAoa = [['Дата', 'Время', 'Сотрудник', 'Табельный №', 'Отдел', 'Питание', 'Блюдо', 'Цена, ₸']];
    [...items]
      .sort((a, b) => String(a.timestamp || '').localeCompare(String(b.timestamp || '')))
      .forEach(m => detAoa.push([
        mealDate(m), String(m.time || '').slice(0, 8), m.employeeName, m.staffId || '',
        m.department || '', m.mealType, m.note || '', Number(m.price) || 0
      ]));
    const wsDet = XLSX.utils.aoa_to_sheet(detAoa);
    wsDet['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 26 }, { wch: 14 }, { wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, wsDet, 'Детализация');

    XLSX.writeFile(wb, `Отчет_питание_${periodLabel()}.xlsx`);
    toast('Excel сформирован');
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
        if (btn.dataset.tab === 'reports') {
          fillReportFilterOptions();
          renderReport();
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

    // Как только видео реально пошло — убираем подсказку поверх картинки
    const empVideo = $('empVideo');
    ['playing', 'loadeddata', 'canplay'].forEach(ev =>
      empVideo.addEventListener(ev, () => { if (empVideo.videoWidth > 0) hideCamHint(); })
    );

    $('refreshMealsBtn').addEventListener('click', () => refreshMeals().catch(e => toast(String(e.message || e), 'err')));
    ['fFrom', 'fTo', 'fType'].forEach(id => $(id).addEventListener('change', renderMeals));
    $('exportCsvBtn').addEventListener('click', exportCsv);

    ['rFrom', 'rTo', 'rEmployee', 'rDepartment'].forEach(id =>
      $(id).addEventListener('change', renderReport));
    $('exportXlsxBtn').addEventListener('click', exportReportXlsx);

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
    // Отчёты по умолчанию — с начала текущего месяца по сегодня
    $('rFrom').value = today.slice(0, 8) + '01';
    $('rTo').value = today;
    await Promise.all([refreshEmployees(), refreshMeals()]);
    fillReportFilterOptions();
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
