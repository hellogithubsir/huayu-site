(() => {
  const root = document.documentElement;
  const languageButton = document.querySelector('.language-toggle');
  const tabs = [...document.querySelectorAll('[data-training]')];
  const panel = document.querySelector('#training-panel');
  const contactButtons = [...document.querySelectorAll('[data-contact-intent]')];
  const copyButton = document.querySelector('#copy-enquiry');
  const copyStatus = document.querySelector('#copy-status');
  const menuButton = document.querySelector('.menu-toggle');
  const menu = document.querySelector('#mobile-nav');
  const mainContent = document.querySelector('#main');
  const footer = document.querySelector('.site-footer');
  let language = 'zh';
  let training = 'week';
  let intent = 'training';
  let copyTimer;
  const choose = (zh, en) => language === 'zh' ? zh : en;
  const trainingData = {
    week: {
      zh: ['周训', '了解周训安排', '向华羽了解周训的具体周期与训练安排。把可到场日期、现有基础和希望改善的技术告诉教务。', ['可到场的日期与天数', '目前水平与训练目标', '班期、费用与安排']],
      en: ['Zhouxun', 'Explore Zhouxun', 'Ask Huayu about the exact schedule and duration. Share your available dates, experience and the skills you want to improve.', ['Your available dates and number of days', 'Your experience and training goals', 'Current dates, fees and arrangements']]
    },
    camp: {
      zh: ['其他训练', '聊聊你的训练目标', '想了解集训或其他训练安排？告诉华羽你的目标、训练经历与可参加时间，咨询当前可提供的选择。', ['目前基础与近期训练情况', '可参加的日期与天数', '当前训练选择与费用']],
      en: ['other training options', 'Talk about your goals', 'Interested in a camp or another training arrangement? Share your goals, experience and available dates to ask what Huayu currently offers.', ['Your experience and recent practice', 'Available dates and number of days', 'Current training options and fees']]
    },
    private: {
      zh: ['私教', '了解私教安排', '带着一个具体问题开始。描述想调整的技术与已有训练经历，咨询教练、课时和可约时间。', ['想重点改善的技术', '近期打球或训练情况', '教练、课时与可约时间']],
      en: ['private coaching', 'Explore private coaching', 'Start with a specific goal. Describe the technique you want to work on and ask about coaches, session lengths and availability.', ['The skill you want to work on', 'Your recent play or practice', 'Coaches, session lengths and availability']]
    }
  };
  function renderTraining() {
    const [name, title, description, points] = trainingData[training][language];
    panel.querySelector('[data-training-title]').textContent = title;
    panel.querySelector('[data-training-description]').textContent = description;
    const list = panel.querySelector('[data-training-points]');
    list.replaceChildren(...points.map(text => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }));
    panel.querySelector('[data-training-cta]').textContent = choose(`咨询${name}`, `Ask about ${name}`);
    panel.setAttribute('aria-labelledby', `tab-${training}`);
    tabs.forEach(tab => {
      const selected = tab.dataset.training === training;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
  }
  function renderEnquiry() {
    const name = trainingData[training][language][0];
    const messages = {
      gear: choose('你好，我想了解华羽装备。我关注的产品是____，目前使用____，希望了解型号、规格与购买方式。', 'Hello, I’m interested in Huayu equipment. I’m looking at ____, currently use ____, and would like to ask about models, specifications and purchasing.'),
      training: choose(`你好，我想了解华羽${name}。我的基础是____，可以到场的日期是____，希望提升____。`, `Hello, I’d like to ask about ${name} at Huayu. My experience is ____, my available dates are ____, and I’d like to improve ____.`),
      stars: choose('你好，我想了解华羽明日之星计划。我的运动经历是____，教学经历是____，希望了解招募条件、训练支持与考核安排。', 'Hello, I’m interested in Huayu’s Next Stars programme. My playing experience is ____, my teaching experience is ____, and I’d like to ask about entry requirements, training support and assessment.')
    };
    document.querySelector('#enquiry-text').textContent = messages[intent];
    contactButtons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.contactIntent === intent)));
    clearTimeout(copyTimer);
    copyStatus.textContent = '';
  }
  function setMenuOpen(open) {
    menu.hidden = !open;
    menuButton.setAttribute('aria-expanded', String(open));
    mainContent.inert = open;
    footer.inert = open;
  }
  languageButton.hidden = false;
  copyButton.hidden = false;
  menuButton.hidden = false;
  document.querySelector('.training-options').hidden = false;
  document.querySelector('.contact-intents').hidden = false;
  languageButton.addEventListener('click', () => {
    const mediaTrack = document.querySelector('[data-media-track][data-media-motion="true"]');
    const mediaRect = mediaTrack?.getBoundingClientRect();
    const mediaPinned = mediaRect && mediaRect.top <= 1 && mediaRect.bottom >= mediaTrack.querySelector('#films').offsetHeight - 1;
    const sections = [...document.querySelectorAll('[data-story-anchor], main > section')];
    const anchor = sections.findLast(section => section.getBoundingClientRect().top <= 88) || sections[0];
    const offset = anchor?.getBoundingClientRect().top;
    language = language === 'zh' ? 'en' : 'zh';
    root.lang = language === 'zh' ? 'zh-CN' : 'en';
    languageButton.textContent = choose('EN', '中文');
    languageButton.setAttribute('aria-label', choose('Switch to English', '切换到中文'));
    document.title = choose('华羽 HUAYU｜装备、成人训练与明日之星', 'Huayu | Equipment, Training & Next Stars');
    document.querySelector('meta[name="description"]').content = choose('认识华羽：羽毛球装备、成人训练、明日之星人才计划，以及一支真正上场的团队。', 'Meet Huayu: badminton equipment, adult training, Next Stars and the people behind the team.');
    document.querySelectorAll('[data-alt-zh]').forEach(element => { element.alt = element.dataset[language === 'zh' ? 'altZh' : 'altEn']; });
    document.querySelectorAll('[data-aria-zh]').forEach(element => { element.setAttribute('aria-label', element.dataset[language === 'zh' ? 'ariaZh' : 'ariaEn']); });
    renderTraining();
    renderEnquiry();
    // 影像章节固定在视口时，由影像视图恢复进度，避免通用锚点再次改写位置。
    if (!mediaPinned && anchor && typeof offset === 'number') {
      requestAnimationFrame(() => window.scrollBy({ top: anchor.getBoundingClientRect().top - offset, behavior: 'instant' }));
    }
  });
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => {
      training = tab.dataset.training;
      renderTraining();
      if (intent === 'training') renderEnquiry();
    });
    tab.addEventListener('keydown', event => {
      let next;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next !== undefined) {
        event.preventDefault();
        tabs[next].focus();
        tabs[next].click();
      }
    });
  });
  document.querySelectorAll('[data-intent]').forEach(link => link.addEventListener('click', () => {
    intent = link.dataset.intent;
    renderEnquiry();
  }));
  contactButtons.forEach(button => button.addEventListener('click', () => {
    intent = button.dataset.contactIntent;
    renderEnquiry();
  }));
  copyButton.addEventListener('click', async () => {
    const message = document.querySelector('#enquiry-text').textContent;
    try {
      await navigator.clipboard.writeText(message);
      copyStatus.textContent = choose('已复制。前往官方账号后粘贴，并补充你的信息。', 'Copied. Paste it at the official account and add your details.');
    } catch {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector('#enquiry-text'));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      copyStatus.textContent = choose('文字已选中，请使用系统复制，再前往官方账号。', 'Text selected. Use your system copy command, then visit the official account.');
    }
    copyTimer = setTimeout(() => { copyStatus.textContent = ''; }, 12000);
  });
  menuButton.addEventListener('click', () => {
    setMenuOpen(menu.hidden);
  });
  matchMedia('(max-width: 760px)').addEventListener('change', event => {
    if (!event.matches && !menu.hidden) setMenuOpen(false);
  });
  document.querySelectorAll('.site-header a').forEach(link => link.addEventListener('click', () => setMenuOpen(false)));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.hidden) { setMenuOpen(false); menuButton.focus(); }
  });

  renderTraining();
  renderEnquiry();
  if (new URLSearchParams(window.location.search).get('lang') === 'en') languageButton.click();
  // 内容默认可见。动画只增强页面，不决定内容是否能被阅读。
  function observeArrivals() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return;
        const media = entry.target.matches('figure');
        entry.target.classList.add(media ? 'is-arriving-media' : 'is-arriving');
        observer.unobserve(entry.target);
      });
    }, { threshold: .12 });
    document.querySelectorAll('[data-enter]').forEach(element => observer.observe(element));
  }
  if (window.huayuBoot && !['ready', 'simplified'].includes(window.huayuBoot.state)) window.addEventListener('huayu:entered', observeArrivals, { once: true });
  else observeArrivals();
})();
