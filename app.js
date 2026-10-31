/* 默写本 · 核心逻辑 */
(function () {
  "use strict";

  var DATA = window.MOKE_DATA;
  var STORE_KEY = "moxie_v1";
  var IVALS = [1, 1, 2, 4, 7, 15]; // 艾宾浩斯间隔：第 s 阶段答对后，下次复习在 IVALS[s] 天后

  /* ---------- 工具 ---------- */
  function todayStr(offset) {
    var d = new Date();
    if (offset) d.setDate(d.getDate() + offset);
    var m = d.getMonth() + 1, day = d.getDate();
    return d.getFullYear() + "-" + (m < 10 ? "0" + m : m) + "-" + (day < 10 ? "0" + day : day);
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)); } catch (e) { return null; }
  }
  function save() { localStorage.setItem(STORE_KEY, JSON.stringify(S)); }

  var S = load() || { items: {}, sessions: [], settings: { dailyNew: 20, dailyReview: 5, v: 2 } };
  S.settings = S.settings || {};
  if (!S.settings.dailyNew) S.settings.dailyNew = 20;
  if (S.settings.dailyReview === undefined) S.settings.dailyReview = 5;
  if (!S.settings.shuffle) S.settings.shuffle = "lesson"; // lesson | all | none
  if (S.settings.scope === undefined) S.settings.scope = null; // null = 全册，否则为课 id 数组
  if (!S.settings.v) { // 老版本升级为「每天最多新学 20、复习 5」
    S.settings.dailyNew = 20;
    S.settings.dailyReview = 5;
    S.settings.v = 2;
  }

  /* ---------- 内容展开 ---------- */
  // 每个条目: { id, lessonId, lessonTitle, lessonNo, type:'word'|'sent', w, p, title, prompt, answer }
  var ALL = [];
  DATA.lessons.forEach(function (les) {
    (les.words || []).forEach(function (x, i) {
      ALL.push({
        id: les.id + "_w" + i, lessonId: les.id, lessonTitle: les.title, lessonNo: les.no,
        type: "word", w: x.w, p: x.p
      });
    });
    (les.sentences || []).forEach(function (x, i) {
      ALL.push({
        id: les.id + "_s" + i, lessonId: les.id, lessonTitle: les.title, lessonNo: les.no,
        type: "sent", title: x.title, prompt: x.prompt, answer: x.answer
      });
    });
  });
  var byId = {};
  ALL.forEach(function (it) { byId[it.id] = it; });

  /* ---------- 判分 ---------- */
  function normalize(s) {
    return (s || "").replace(/[\s，。！？、；：""''（）,.\!\?;:'"()]/g, "");
  }

  /* ---------- 顺序与范围 ---------- */
  function dayDiff(from, to) { // to - from，单位天
    return Math.round((new Date(to + "T00:00:00") - new Date(from + "T00:00:00")) / 86400000);
  }
  function shuffleArr(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  // lesson: 课内随机、课与课之间按课本顺序；all: 整批完全随机；none: 按课本顺序
  function applyOrder(list) {
    var mode = S.settings.shuffle || "lesson";
    if (mode === "none" || list.length < 2) return list.slice();
    if (mode === "all") return shuffleArr(list.slice());
    var groups = [], map = {};
    list.forEach(function (it) {
      if (!map[it.lessonId]) { map[it.lessonId] = []; groups.push(it.lessonId); }
      map[it.lessonId].push(it);
    });
    var out = [];
    groups.forEach(function (g) {
      shuffleArr(map[g]).forEach(function (x) { out.push(x); });
    });
    return out;
  }
  function inScope(it) {
    var sc = S.settings.scope;
    if (!sc) return true;
    return sc.indexOf(it.lessonId) >= 0;
  }
  function scopeLabel() {
    var sc = S.settings.scope;
    if (!sc) return "全册";
    return "自选 " + sc.length + " 课";
  }

  /* ---------- 调度 ---------- */
  function grade(id, ok) {
    var st = S.items[id];
    if (!st) { st = { s: 0, due: todayStr(), r: 0, w: 0, nb: false }; }
    if (ok) {
      st.r++;
      st.nb = false;
      st.s = Math.min(5, st.s + 1);
      st.due = todayStr(IVALS[st.s]);
    } else {
      st.w++;
      st.s = 0;
      st.due = todayStr(1);
      st.nb = true;
    }
    S.items[id] = st;
  }

  // 紧急度：逾期越久、错得越多、掌握阶段越低 → 越靠前
  function urgency(st, t) {
    var overdue = Math.max(0, dayDiff(st.due || t, t));
    return overdue * 2 + (st.w || 0) * 3 + (5 - (st.s || 0));
  }

  // 到期的复习题，按紧急度降序
  function dueItems() {
    var t = todayStr();
    var due = ALL.filter(function (it) {
      var st = S.items[it.id];
      return st && st.due <= t && st.s < 5 && inScope(it);
    });
    due.sort(function (a, b) { return urgency(S.items[b.id], t) - urgency(S.items[a.id], t); });
    return due;
  }

  function buildTodayQueue() {
    var cap = Math.max(0, parseInt(S.settings.dailyReview, 10) || 0);
    var fresh = ALL.filter(function (it) { return !S.items[it.id] && inScope(it); })
      .slice(0, S.settings.dailyNew);
    return dueItems().slice(0, cap).concat(applyOrder(fresh));
  }

  function todayDoneCount() {
    var t = todayStr();
    var s = S.sessions.filter(function (x) { return x.date === t; });
    return s.length ? s.reduce(function (a, b) { return a + b.total; }, 0) : 0;
  }

  function streakDays() {
    var dates = {};
    S.sessions.forEach(function (x) { dates[x.date] = true; });
    var n = 0, off = 0;
    if (!dates[todayStr(0)]) off = 1; // 今天还没开始，从昨天起算
    while (dates[todayStr(-off)]) { n++; off++; }
    return n;
  }

  /* ---------- 会话 ---------- */
  var sess = null;

  function startSession(queue, label) {
    if (!queue.length) { alert("没有需要默写的内容"); return; }
    sess = { queue: queue, idx: 0, right: 0, wrongIds: [], label: label || "今日默写" };
    document.getElementById("session").classList.remove("hidden");
    showItem();
  }

  function showItem() {
    var it = sess.queue[sess.idx];
    document.getElementById("progBar").style.width = (sess.idx / sess.queue.length * 100) + "%";
    document.getElementById("sessCount").textContent = (sess.idx + 1) + "/" + sess.queue.length;
    var body = document.getElementById("sessBody");
    var h = "";
    if (it.type === "word") {
      h += '<div class="tag-type">看拼音写词语</div>';
      h += '<div class="pinyin">' + it.p + "</div>";
    } else {
      h += '<div class="tag-type">句子默写</div>';
      h += '<div class="sent-title">' + it.title + "</div>";
      h += it.prompt
        ? '<div class="sent-prompt">' + it.prompt + "____</div>"
        : '<div class="sent-prompt" style="font-size:22px">默写整句</div>';
    }
    h += '<div class="input-wrap">';
    h += '<input class="answer-input" id="ansInput" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false">';
    h += '<div class="edit-row">';
    h += '<button class="erase-btn" id="backBtn">⌫ 退一格</button>';
    h += '<button class="erase-btn" id="eraseBtn">✕ 擦掉重写</button>';
    h += "</div>";
    h += "</div>";
    h += '<div class="session-tip">在键盘上切换到「简体手写」即可手写输入</div>';
    h += '<button class="btn" id="submitBtn">提交</button>';
    h += '<button class="btn ghost" id="skipBtn">不会，跳过</button>';
    body.innerHTML = h;
    var inp = document.getElementById("ansInput");
    inp.focus();

    // 两个按钮都不抢焦点，点完光标还在输入框里
    ["backBtn", "eraseBtn"].forEach(function (bid) {
      var b = document.getElementById(bid);
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("touchstart", function (e) { e.preventDefault(); }, { passive: false });
    });

    document.getElementById("backBtn").onclick = function () {
      var v = inp.value;
      if (!v) { inp.focus(); return; }
      var pos = (inp.selectionStart == null || inp.selectionStart > v.length) ? v.length : inp.selectionStart;
      if (pos === 0) { inp.focus(); return; }
      inp.value = v.slice(0, pos - 1) + v.slice(pos);
      try { inp.setSelectionRange(pos - 1, pos - 1); } catch (e) { }
      inp.focus();
    };
    document.getElementById("eraseBtn").onclick = function () {
      inp.value = "";
      inp.focus();
    };
    document.getElementById("submitBtn").onclick = function () { judge(false); };
    document.getElementById("skipBtn").onclick = function () { judge(true); };
    inp.addEventListener("keydown", function (e) { if (e.key === "Enter") judge(false); });
  }

  function judge(skipped) {
    var it = sess.queue[sess.idx];
    var inp = document.getElementById("ansInput");
    var input = skipped ? "" : (inp ? inp.value : "");
    if (!skipped && !normalize(input)) {
      inp.placeholder = "先写一个，或点「不会，跳过」";
      inp.focus();
      return;
    }
    var ok = !skipped && normalize(input) === normalize(it.answer || it.w);
    grade(it.id, ok);
    if (ok) { sess.right++; } else { sess.wrongIds.push(it.id); }
    showFeedback(it, ok, input, skipped);
  }

  var autoTimer = null;

  function showFeedback(it, ok, input, skipped) {
    var body = document.getElementById("sessBody");
    var ans = it.type === "word" ? it.w : it.answer;
    var h = '<div class="feedback">';
    h += '<div class="fb-mark ' + (ok ? "ok" : "bad") + '">' + (ok ? "√" : "×") + "</div>";
    h += '<div class="fb-word">' + ans + "</div>";
    if (it.type === "word") h += '<div class="fb-pinyin">' + it.p + "</div>";
    if (it.type === "sent") h += '<div class="fb-pinyin">' + it.title + "</div>";
    if (!ok && !skipped && normalize(input)) h += '<div class="fb-your">你写的是：' + input + "</div>";
    if (!ok && skipped) h += '<div class="fb-your">这题跳过了，多看两眼记住它</div>';
    h += '<button class="btn" id="nextBtn">' + (sess.idx + 1 >= sess.queue.length ? "完成" : "下一个") + "</button>";
    h += "</div>";
    body.innerHTML = h;
    var nextBtn = document.getElementById("nextBtn");
    nextBtn.onclick = function () {
      if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
      sess.idx++;
      if (sess.idx >= sess.queue.length) finishSession(); else showItem();
    };
    if (ok) {
      autoTimer = setTimeout(function () {
        autoTimer = null;
        if (document.getElementById("nextBtn")) nextBtn.click();
      }, 900);
    }
  }

  function finishSession() {
    S.sessions.push({ date: todayStr(), total: sess.queue.length, right: sess.right });
    save();
    var total = sess.queue.length, right = sess.right;
    var wrongList = sess.wrongIds.map(function (id) { return byId[id]; });
    var body = document.getElementById("sessBody");
    document.getElementById("progBar").style.width = "100%";
    var h = '<div class="result-title">' + sess.label + " 完成</div>";
    h += '<div class="result-score">' + right + " / " + total + "</div>";
    if (wrongList.length) {
      h += '<div class="result-wrong"><h4>这些词进了错题本，会安排复习</h4>';
      wrongList.forEach(function (it) {
        h += '<span class="wrong-chip">' + (it.type === "word" ? it.w : it.answer) + "</span>";
      });
      h += "</div>";
    } else {
      h += '<div class="result-wrong" style="text-align:center">全部正确，太棒了！</div>';
    }
    h += '<button class="btn" id="doneBtn">好的</button>';
    body.innerHTML = h;
    document.getElementById("doneBtn").onclick = function () {
      document.getElementById("session").classList.add("hidden");
      sess = null;
      render();
    };
  }

  document.getElementById("quitBtn").onclick = function () {
    if (sess && !confirm("确定退出吗？本次进度不会保存")) return;
    document.getElementById("session").classList.add("hidden");
    sess = null;
    render();
  };

  /* ---------- 页面渲染 ---------- */
  var main = document.getElementById("main");
  var curTab = "today";

  function render() {
    document.getElementById("streakBadge").textContent =
      "连续 " + streakDays() + " 天 · 今日已写 " + todayDoneCount() + " 题";
    if (curTab === "today") renderToday();
    else if (curTab === "practice") renderPractice();
    else if (curTab === "notebook") renderNotebook();
    else renderMe();
  }

  function renderToday() {
    var q = buildTodayQueue();
    var reviewN = q.filter(function (it) { return S.items[it.id]; }).length;
    var newN = q.length - reviewN;
    var h = "";
    var pending = dueItems().length;
    h += '<div class="card"><h3>今日任务</h3><div class="sub">到期复习 ' + reviewN +
      " 个（越易忘的越靠前）+ 新学 " + newN + " 个 · 范围：" + scopeLabel() + "</div>";
    if (pending > reviewN) {
      h += '<div class="sub" style="margin-top:6px">还有 ' + (pending - reviewN) +
        " 个待复习排着队（共 " + pending + " 个），明天从最紧急的继续。</div>";
    }
    h += '<button class="btn" id="todayBtn"' + (q.length ? "" : " disabled") + ">开始今日默写</button></div>";
    // 学习进度
    var inAll = ALL.filter(inScope);
    var learned = 0;
    var mastered = 0, rTotal = 0, wTotal = 0;
    inAll.forEach(function (it) {
      var st = S.items[it.id];
      if (!st) return;
      learned++;
      if (st.s >= 5) mastered++;
      rTotal += st.r; wTotal += st.w;
    });
    h += '<div class="stat-row">';
    h += '<div class="card"><div class="big-num">' + learned + "</div><div class='sub'>已学 / 共 " + inAll.length + "</div></div>";
    h += '<div class="card"><div class="big-num">' + mastered + "</div><div class='sub'>已掌握</div></div>";
    h += '<div class="card"><div class="big-num">' + (rTotal + wTotal ? Math.round(rTotal / (rTotal + wTotal) * 100) : 0) + "%</div><div class='sub'>总正确率</div></div>";
    h += "</div>";
    // 复习计划说明
    h += '<div class="card"><h3>复习节奏（艾宾浩斯）</h3><div class="sub">答对后按 1 → 2 → 4 → 7 → 15 天自动安排复习；写错第二天再来，并进入错题本。</div></div>';
    main.innerHTML = h;
    var btn = document.getElementById("todayBtn");
    if (btn) btn.onclick = function () { startSession(q, "今日默写"); };
  }

  function renderPractice() {
    var units = {};
    DATA.lessons.forEach(function (les) {
      (units[les.unit] = units[les.unit] || []).push(les);
    });
    var keys = Object.keys(units).sort(function (a, b) { return a - b; });
    var h = '<div class="card"><h3>按课练习</h3><div class="sub">共 ' + DATA.lessons.length +
      " 课 · 点任意一课开始单独默写</div></div>";
    keys.forEach(function (u) {
      h += '<div class="card"><h3>第' + u + "单元</h3>";
      units[u].forEach(function (les) {
        var n = (les.words || []).length + (les.sentences || []).length;
        var done = 0;
        (les.words || []).forEach(function (x, i) { if (S.items[les.id + "_w" + i]) done++; });
        (les.sentences || []).forEach(function (x, i) { if (S.items[les.id + "_s" + i]) done++; });
        h += '<div class="lesson-item"><div><div class="lesson-name">' + les.no + " " + les.title + "</div>" +
          '<div class="lesson-meta">共 ' + n + " 项 · 已学 " + done + "</div></div>" +
          '<button class="lesson-go" data-les="' + les.id + '">开始</button></div>';
      });
      h += "</div>";
    });
    main.innerHTML = h;
    Array.prototype.forEach.call(document.querySelectorAll(".lesson-go"), function (b) {
      b.onclick = function () {
        var les = DATA.lessons.filter(function (l) { return l.id === b.getAttribute("data-les"); })[0];
        var q = [];
        (les.words || []).forEach(function (x, i) { q.push(byId[les.id + "_w" + i]); });
        (les.sentences || []).forEach(function (x, i) { q.push(byId[les.id + "_s" + i]); });
        startSession(applyOrder(q), les.title);
      };
    });
  }

  function renderNotebook() {
    var list = ALL.filter(function (it) {
      var st = S.items[it.id];
      return st && st.nb;
    });
    var h = "";
    if (!list.length) {
      h = '<div class="empty">错题本是空的，继续保持！</div>';
      main.innerHTML = h;
      return;
    }
    h += '<div class="card"><h3>错题本 · ' + list.length + " 个</h3><div class='sub'>重默全对会自动移出</div>" +
      '<button class="btn" id="nbBtn">重默错题</button></div><div class="card">';
    list.forEach(function (it) {
      var st = S.items[it.id];
      h += '<div class="nb-item"><div><div class="nb-word">' + (it.type === "word" ? it.w : it.answer) + "</div>" +
        '<div class="nb-pinyin">' + (it.type === "word" ? it.p : it.title + " " + it.prompt) + " · " + it.lessonNo + "</div></div>" +
        '<div class="nb-count">错 ' + st.w + " 次</div></div>";
    });
    h += "</div>";
    main.innerHTML = h;
    document.getElementById("nbBtn").onclick = function () { startSession(list, "错题重默"); };
  }

  function renderMe() {
    var h = '<div class="card"><h3>设置</h3>';
    h += '<div class="set-row"><span>每天最多新学</span><input type="number" id="dailyNew" min="3" max="30" value="' + S.settings.dailyNew + '"></div>';
    h += '<div class="set-row"><span>每天最多复习</span><input type="number" id="dailyReview" min="0" max="50" value="' + S.settings.dailyReview + '"></div>';
    h += '<div class="set-row" style="border-bottom:none"><span>新词出题顺序</span></div>';
    h += '<div class="scope-chips">';
    [["lesson", "课内随机"], ["all", "整批随机"], ["none", "按课本顺序"]].forEach(function (o) {
      h += '<button class="scope-chip' + (S.settings.shuffle === o[0] ? " on" : "") +
        '" data-order="' + o[0] + '">' + o[1] + "</button>";
    });
    h += "</div>";
    h += '<div class="sub" style="margin-top:10px">课内随机 = 同一课的词打乱出，课与课之间仍按课本先后。</div>';
    h += '<div class="sub" style="margin-top:6px">复习题始终按紧急度排：逾期越久、错得越多的排越前面。</div>';
    h += "</div>";

    var units = {};
    DATA.lessons.forEach(function (les) { (units[les.unit] = units[les.unit] || []).push(les); });
    var ukeys = Object.keys(units).sort(function (a, b) { return a - b; });
    h += '<div class="card"><h3>默写范围</h3><div class="sub">勾选要默的课，默认全册。当前：' + scopeLabel() + "</div>";
    h += '<div class="scope-chips" style="margin-top:10px">';
    h += '<button class="scope-chip" id="scAll">全册</button>';
    h += '<button class="scope-chip" id="scNone">全部取消</button>';
    h += "</div>";
    ukeys.forEach(function (u) {
      h += '<div class="scope-unit">第' + u + '单元<button class="scope-mini" data-unit="' + u + '">选本单元</button></div>';
      h += '<div class="scope-chips">';
      units[u].forEach(function (les) {
        var on = !S.settings.scope || S.settings.scope.indexOf(les.id) >= 0;
        h += '<button class="scope-chip' + (on ? " on" : "") + '" data-scope="' + les.id + '">' +
          les.no + " " + les.title + "</button>";
      });
      h += "</div>";
    });
    h += '<div class="sub" style="margin-top:10px">只影响「今日」任务；练习页仍可单独点任意一课。</div>';
    h += "</div>";
    h += '<div class="card"><h3>数据备份</h3><div class="sub">学习记录保存在本机浏览器里，换设备前请先导出。</div>';
    h += '<div class="set-row"><span>导出备份</span><button class="btn small ghost" id="expBtn">导出 JSON</button></div>';
    h += '<div class="set-row"><span>导入备份</span><input type="file" id="impFile" accept=".json"></div>';
    h += '<div class="set-row"><span>清空全部记录</span><button class="btn small red" id="rstBtn">清空</button></div>';
    h += "</div>";
    var nw = 0, ns = 0;
    DATA.lessons.forEach(function (l) { nw += (l.words || []).length; ns += (l.sentences || []).length; });
    h += '<div class="card"><h3>内容</h3><div class="sub">' + DATA.book + " · 全册 " +
      DATA.lessons.length + " 课 · " + nw + " 个词语 + " + ns + " 条古诗名句</div></div>";
    main.innerHTML = h;

    function setScope(arr) {
      S.settings.scope = (arr && arr.length === DATA.lessons.length) ? null : arr;
      save();
      render();
    }
    Array.prototype.forEach.call(document.querySelectorAll("[data-order]"), function (b) {
      b.onclick = function () {
        S.settings.shuffle = b.getAttribute("data-order");
        save(); render();
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-scope]"), function (b) {
      b.onclick = function () {
        var id = b.getAttribute("data-scope");
        var sc = S.settings.scope ? S.settings.scope.slice()
          : DATA.lessons.map(function (l) { return l.id; });
        var i = sc.indexOf(id);
        if (i >= 0) sc.splice(i, 1); else sc.push(id);
        setScope(sc);
      };
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-unit]"), function (b) {
      b.onclick = function () {
        var u = b.getAttribute("data-unit");
        var sc = S.settings.scope ? S.settings.scope.slice() : [];
        units[u].forEach(function (l) { if (sc.indexOf(l.id) < 0) sc.push(l.id); });
        setScope(sc);
      };
    });
    document.getElementById("scAll").onclick = function () { setScope(null); };
    document.getElementById("scNone").onclick = function () { setScope([]); };

    document.getElementById("dailyNew").onchange = function (e) {
      S.settings.dailyNew = Math.max(3, Math.min(30, parseInt(e.target.value) || 20));
      save();
      render();
    };
    document.getElementById("dailyReview").onchange = function (e) {
      var v = parseInt(e.target.value, 10);
      S.settings.dailyReview = isNaN(v) ? 5 : Math.max(0, Math.min(50, v));
      save();
      render();
    };
    document.getElementById("expBtn").onclick = function () {
      var blob = new Blob([JSON.stringify(S)], { type: "application/json" });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "moxie-backup-" + todayStr() + ".json";
      a.click();
    };
    document.getElementById("impFile").onchange = function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var obj = JSON.parse(r.result);
          if (obj && obj.items && obj.settings) {
            S = obj;
            S.settings = S.settings || {};
            if (!S.settings.dailyNew) S.settings.dailyNew = 10;
            if (!S.settings.shuffle) S.settings.shuffle = "lesson";
            if (S.settings.scope === undefined) S.settings.scope = null;
            save(); render();
            alert("导入成功");
          } else alert("文件格式不对");
        } catch (err) { alert("导入失败"); }
      };
      r.readAsText(f);
    };
    document.getElementById("rstBtn").onclick = function () {
      if (confirm("确定清空所有学习记录吗？")) {
        S = {
          items: {}, sessions: [],
          settings: { dailyNew: S.settings.dailyNew, shuffle: S.settings.shuffle, scope: S.settings.scope }
        };
        save(); render();
      }
    };
  }

  /* ---------- 标签切换 ---------- */
  Array.prototype.forEach.call(document.querySelectorAll(".tab"), function (t) {
    t.onclick = function () {
      document.querySelector(".tab.active").classList.remove("active");
      t.classList.add("active");
      curTab = t.getAttribute("data-tab");
      render();
    };
  });

  render();
})();
