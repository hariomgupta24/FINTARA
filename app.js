/* ========================================
   Barclays AI Model Interface — Logic
   ======================================== */

(function () {
  'use strict';

  // ── DOM References ──
  const sidebar = document.getElementById('sidebar');
  const mobileToggle = document.getElementById('mobileToggle');
  const overlay = document.getElementById('overlay');
  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const sendBtn = document.getElementById('sendBtn');
  const typingEl = document.getElementById('typingIndicator');
  const welcomeCard = document.getElementById('welcomeCard');
  const quickActions = document.getElementById('quickActions');
  const newChatBtn = document.getElementById('newChatBtn');
  const clearChatBtn = document.getElementById('clearChatBtn');
  const navLinks = document.querySelectorAll('.nav-link');

  // ── Simulated AI Responses ──
  const responses = {
    balance: [
      "Your current account ending in **4821** has a balance of **£12,458.32**. Your savings account ending in **7903** holds **£34,210.00**.\n\nWould you like me to provide a detailed breakdown of your recent activity?",
      "Here's a summary of your accounts:\n\n• **Current Account** (****4821): £12,458.32\n• **Savings Account** (****7903): £34,210.00\n• **ISA** (****6155): £8,750.00\n\nTotal across all accounts: **£55,418.32**"
    ],
    transactions: [
      "Here are your most recent transactions:\n\n| Date | Description | Amount |\n|------|-------------|--------|\n| 23 Feb | Tesco Superstore | -£62.40 |\n| 22 Feb | Salary – ACME Corp | +£3,450.00 |\n| 21 Feb | Netflix UK | -£10.99 |\n| 20 Feb | TfL Travel | -£38.50 |\n| 19 Feb | Amazon Marketplace | -£27.99 |\n\nWould you like to filter by category or date range?",
      "Your last 5 transactions on your current account:\n\n1. **£62.40** — Tesco Superstore (23 Feb)\n2. **£3,450.00** — Salary credit from ACME Corp (22 Feb)\n3. **£10.99** — Netflix UK (21 Feb)\n4. **£38.50** — TfL Travel (20 Feb)\n5. **£27.99** — Amazon Marketplace (19 Feb)\n\nYour spending this month is **12% lower** than last month. Great job! 📊"
    ],
    mortgage: [
      "Here are our current mortgage rates:\n\n🏠 **Fixed Rate Mortgages**\n• 2-year fixed: **4.29%** APR\n• 5-year fixed: **4.15%** APR\n• 10-year fixed: **4.39%** APR\n\n🔄 **Tracker Mortgages**\n• Base rate + 0.75%: Currently **5.00%**\n\nWould you like me to calculate monthly payments for a specific amount?",
      "Our latest mortgage products for you:\n\n**First-time buyer rates** start from **4.09%** (2-year fixed)\n**Remortgage rates** from **4.15%** (5-year fixed)\n\nBased on your profile, you may qualify for our **Premier** mortgage products with preferential rates.\n\nShall I schedule a call with a mortgage advisor?"
    ],
    realestate: [
      "Great question! Here's my real estate advice:\n\n🏡 **Before You Buy — Key Steps**\n1. **Get a mortgage agreement in principle** — shows sellers you're serious. Barclays can issue one in under 24 hours.\n2. **Set a realistic budget** — factor in stamp duty, solicitor fees (£1,000–£2,000), surveys (£250–£700), and moving costs.\n3. **Research the area** — check flood risk, local schools, transport links, and recent sale prices on Land Registry.\n4. **Hire a RICS-accredited surveyor** — a HomeBuyer Report costs ~£400 and can save you thousands.\n\n💰 **Stamp Duty (England & N. Ireland)**\n• Up to £250,000: **0%**\n• £250,001–£925,000: **5%**\n• £925,001–£1.5m: **10%**\n• Above £1.5m: **12%**\n• **First-time buyers** pay 0% up to £425,000\n\n📈 **Market Insight**\nAverage UK house prices rose **1.3%** year-on-year. The South East and Midlands remain strong growth areas.\n\nWould you like a personalised affordability assessment or help finding a mortgage?",
      "Here's comprehensive real estate guidance from Barclays:\n\n🏠 **Buying Your First Home**\n• You can borrow typically **4–4.5x** your annual income\n• A **10–15% deposit** gets you better rates (5% minimum available)\n• Use a **Lifetime ISA** for the 25% government bonus (up to £1,000/year)\n• Budget an extra **£5,000–£10,000** for fees, surveys, and furnishing\n\n🔑 **Selling Property Tips**\n• Get **3 estate agent valuations** before listing\n• Properties sell fastest in **spring (March–May)**\n• Declutter and stage rooms — staged homes sell **20% faster**\n• Consider an **EPC rating upgrade** (loft insulation, double glazing) to add value\n\n📊 **Buy-to-Let Considerations**\n• Typically need a **25% deposit** minimum\n• Rental yield should aim for **5%+ gross**\n• You'll pay an extra **3% stamp duty surcharge**\n• Factor in letting agent fees (8–12% of rent), maintenance, and void periods\n\nWould you like me to run an affordability calculator or connect you with our property specialists?",
      "Here's my tailored real estate advice:\n\n🏘️ **Property Valuation Tips**\n• Check **sold prices** on Rightmove/Zoopla for comparable properties in the area\n• A professional **RICS valuation** (£300–£600) is essential before making an offer\n• Look at **price per square foot** — a better metric than overall price\n• Don't forget to check **lease length** for flats (below 80 years = significant cost to extend)\n\n⚠️ **Common Mistakes to Avoid**\n• Skipping the survey to save money — this can lead to costly surprises\n• Not accounting for **service charges** and **ground rent** on leasehold properties\n• Overextending your budget — keep mortgage payments under **30% of income**\n• Ignoring the **Energy Performance Certificate** — low ratings mean higher bills\n\n🏗️ **Adding Value to Your Property**\n• Kitchen renovation: adds approx. **5–10%** to value\n• Loft conversion: adds approx. **15–20%** to value\n• Extension: adds approx. **10–15%** to value\n• Good EPC rating: increasingly important for buyers\n\nShall I help you estimate your property's current value or explore renovation financing?"
    ],
    investment: [
      "Here are some investment options to consider:\n\n📈 **Barclays Smart Investor**\n• Ready-made investments from £1,000\n• Choose from cautious, balanced, or adventurous portfolios\n\n💎 **Stocks & Shares ISA**\n• Tax-free allowance of £20,000/year\n• Wide range of funds and shares\n\n🌍 **Global Investment Fund**\n• Diversified exposure across markets\n• Average return of 8.2% over 5 years\n\nWould you like a personalized recommendation?",
      "Based on your financial profile, here are my top suggestions:\n\n1. **Barclays Multi-Impact Growth Fund** — Sustainable investing with strong returns\n2. **Global Equity Index Tracker** — Low-cost, diversified exposure\n3. **Barclays Wealth Builder ISA** — Tax-efficient long-term growth\n\nYour current risk profile is **Moderate**. Would you like me to adjust recommendations based on a different risk level?"
    ],
    savings: [
      "Here are some tips to boost your savings:\n\n💡 **Automated Savings**\nSet up a standing order to transfer a fixed amount on payday — even £50/month adds up to £600/year.\n\n📊 **Round-Up Feature**\nActivate our Barclays Round-Up feature to round up every purchase to the nearest £1 and save the difference.\n\n🔒 **Rainy Day Fund**\nAim for 3-6 months of expenses (approx. **£8,000-£15,000** based on your spending).\n\n📈 **High-Interest Savers**\nOur Everyday Saver offers **4.50% AER** on balances up to £5,000.\n\nWant me to set any of these up for you?",
    ],
    isa: [
      "Here's a breakdown of ISA account types:\n\n📋 **Cash ISA**\n• Tax-free interest on cash savings\n• Current rate: **4.25% AER**\n• Instant access or fixed-term\n\n📈 **Stocks & Shares ISA**\n• Invest tax-free in funds, shares & bonds\n• Higher potential returns (but capital at risk)\n\n🏠 **Lifetime ISA (LISA)**\n• Save up to £4,000/year\n• 25% government bonus\n• For first home or retirement\n\n🔀 **Innovative Finance ISA**\n• Peer-to-peer lending within an ISA wrapper\n\nYour total ISA allowance is **£20,000** for this tax year. You've used **£8,750** so far.\n\nWould you like to open or top up an ISA?",
    ],
    loans: [
      "Here are our current personal loan options:\n\n💷 **Barclays Personal Loan**\n• Borrow **£1,000–£50,000**\n• Rates from **6.9% APR** (representative)\n• Terms: 1–8 years\n• No early repayment fees\n\n🚗 **Car Finance**\n• New & used vehicle loans available\n• Competitive rates from **7.2% APR**\n• Flexible terms up to 7 years\n\n🏠 **Home Improvement Loan**\n• Unsecured loans up to **£25,000**\n• Fixed monthly payments\n• Funds available within 24 hours\n\nWould you like a personalised quote based on the amount you need?",
    ],
    fallback: [
      "That's a great question! While I process the details, here's what I can help you with:\n\n• Account balances & statements\n• Transaction history & spending insights\n• Mortgage & loan enquiries\n• Real estate & property advice\n• Investment guidance\n• Savings & ISA information\n• **Letter of Credit (LC) services** — Apply online\n• Card management\n\nCould you tell me more about what you need?",
      "Thank you for your question. As your Barclays AI assistant, I can help with:\n\n🏦 **Banking** — Accounts, transfers, payments\n💳 **Cards** — Credit cards, limits, rewards\n🏠 **Real Estate** — Property advice, buying/selling guidance\n🔑 **Mortgages** — Rates, applications, calculators\n📈 **Investments** — Portfolios, ISAs, funds\n💰 **Savings** — Tips, accounts, goals\n📄 **Trade Finance** — [Apply for a Letter of Credit](loc-client.html) | [Officer Dashboard](loc-officer.html)\n\nPlease feel free to ask me anything specific!",
    ],
    loc: [
      "A **Letter of Credit (LC)** is a fundamental trade finance instrument issued by a bank that guarantees payment to a seller (beneficiary/exporter) once they fulfill the terms of the contract.\n\n📄 **How it works at Barclays:**\n1. **Buyer (Applicant)** in India applies to Barclays for an LC\n2. **Barclays (Issuing Bank)** evaluates creditworthiness and issues the LC\n3. **Advising Bank** in the exporter's country notifies the seller\n4. **Seller (Beneficiary)** ships goods and presents documents\n5. **Barclays** verifies documents and makes payment\n\n🔑 **Types of LC we offer:**\n• **Sight LC** — Payment upon document presentation\n• **Usance LC** — Deferred payment (30/60/90/180 days)\n• **Revolving LC** — Auto-reinstated for repeat shipments\n• **Standby LC** — Used as a guarantee instrument\n\n👉 Ready to apply? [**Submit your LC Application →**](loc-client.html)\n\nYou can also upload an existing PDF and our AI will auto-extract all key fields for you!",

      "**Barclays Trade Finance — Letter of Credit (LC) Services**\n\n📋 **Key Information Required for an LC:**\n\n| Category | Details |\n|----------|---------|\n| Applicant | Name, address, account no. |\n| Beneficiary | Exporter name, country, bank SWIFT |\n| LC Type | Sight / Usance / Revolving / Standby |\n| Amount | Currency and amount (e.g. EUR 500,000) |\n| Shipment | Ports, goods, incoterms (FOB/CIF etc.) |\n| Expiry | Date and place of expiry |\n| Documents | Invoice, B/L, packing list, COO etc. |\n\n💡 **Why Barclays?**\n• AI-powered document extraction — just upload your PDF\n• Real-time credit assessment\n• End-to-end digital processing\n• Competitive processing fees and FX rates\n\n[**Apply for LC Now →**](loc-client.html) | [**Officer Dashboard →**](loc-officer.html)",
    ]
  };

  // ── Helpers ──
  function getTime() {
    return new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  }

  function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function classify(text) {
    const t = text.toLowerCase();
    if (/balance|how much|account\s?(balance|summary)?/.test(t)) return 'balance';
    if (/transaction|recent|spending|payment|purchase/.test(t)) return 'transactions';
    if (/letter\s+of\s+credit|\bloc\b|\blc\b|trade\s+finance|sight\s+lc|usance|revolving\s+lc|standby\s+lc|incoterm|bill\s+of\s+lading|beneficiary|issuing\s+bank|advising\s+bank|import\s+finance|export\s+finance|apply.*(lc|credit)|shipment|port\s+of|swift.?code/.test(t)) return 'loc';
    if (/real\s?estate|property\s?(advice|market|value|invest)|buy(ing)?\s?(a\s?)?house|sell(ing)?\s?(a\s?)?(house|home|flat|property)|first[- ]?time\s?buyer|stamp\s?duty|buy[- ]?to[- ]?let|estate\s?agent|surveyor|conveyancing|lease(hold)?|freehold|renovation|home\s?value|property\s?tip/.test(t)) return 'realestate';
    if (/mortgage|home\s?loan|remortgage|mortgage\s?rate/.test(t)) return 'mortgage';
    if (/invest|portfolio|stock|share|fund|etf/.test(t)) return 'investment';
    if (/sav(e|ing)|budget|money\s?tip|cut\s?cost/.test(t)) return 'savings';
    if (/isa|individual\s?savings/.test(t)) return 'isa';
    if (/loan|borrow|finance|credit(?!\s?card)/.test(t)) return 'loans';
    return 'fallback';
  }

  function formatMarkdownLite(text) {
    // Bold
    let html = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // ── Chat Logic ──
  function hideWelcome() {
    if (welcomeCard) {
      welcomeCard.style.opacity = '0';
      welcomeCard.style.transform = 'translateY(-10px) scale(0.98)';
      welcomeCard.style.transition = '0.3s ease';
      setTimeout(() => { welcomeCard.style.display = 'none'; }, 300);
    }
  }

  function appendMessage(role, text) {
    const msg = document.createElement('div');
    msg.classList.add('message', role);

    const avatar = document.createElement('div');
    avatar.classList.add('msg-avatar');
    avatar.textContent = role === 'user' ? 'JD' : 'AI';

    const content = document.createElement('div');
    content.classList.add('msg-content');
    content.innerHTML = formatMarkdownLite(text);

    const time = document.createElement('span');
    time.classList.add('msg-time');
    time.textContent = getTime();
    content.appendChild(time);

    msg.appendChild(avatar);
    msg.appendChild(content);
    chatMessages.appendChild(msg);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function showTyping() {
    typingEl.classList.add('active');
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function hideTyping() {
    typingEl.classList.remove('active');
  }

  async function handleSend(text) {
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    hideWelcome();
    appendMessage('user', trimmed);
    chatInput.value = '';
    chatInput.style.height = 'auto';
    toggleSendBtn();

    showTyping();

    // Custom Live Logic for LC Status Checking
    const isStatusCheck = /status|where is my lc|track/i.test(trimmed) && /lc|letter of credit/i.test(trimmed);
    const refMatch = trimmed.match(/BRC-LC-\d{4}-\d{5}/i);

    if (isStatusCheck || refMatch) {
      try {
        let appData = null;
        if (refMatch) {
          const res = await fetch(`http://localhost:3000/api/applications/${refMatch[0].toUpperCase()}`);
          const data = await res.json();
          if (data.success && data.application) appData = data.application;
        } else {
          // Find nearest LC (simulating authenticated user context)
          const res = await fetch(`http://localhost:3000/api/applications`);
          const data = await res.json();
          if (data.success && data.applications && data.applications.length > 0) {
            appData = data.applications[0];
          }
        }

        hideTyping();

        if (appData) {
          let msg = `I found your Letter of Credit application:\n\n**Reference:** ${appData.ref}\n**Applicant:** ${appData.applicantName || 'N/A'}\n**Amount:** ${appData.lcCurrency} ${parseFloat(appData.lcAmount || 0).toLocaleString()}\n\n**Current Status:** \`${appData.status}\``;

          if (appData.status === 'Sent to Advising Bank') {
            msg += `\n\n✅ **Great news!** Your Letter of Credit has been successfully transmitted via the SWIFT network to the Advising Bank (${appData.advisingBank || 'the beneficiary bank'}). The beneficiary will be notified shortly.`;
          } else if (appData.status === 'Approved') {
            msg += `\n\nYour application is approved and is currently awaiting final generation and dispatch to the Advising Bank.`;
          } else if (appData.status === 'Pending Review') {
            msg += `\n\nYour application is under review by our Trade Finance team. We will notify you once it progresses.`;
          }

          appendMessage('ai', msg);
        } else {
          appendMessage('ai', "I couldn't find any recent Letter of Credit applications under your profile. If you have a specific reference number (e.g. `BRC-LC-...`), please provide it!");
        }
        return;
      } catch (e) {
        console.error("Error fetching status:", e);
        // Fallback to default simulation
      }
    }

    // Default Simulate AI
    const delay = 800 + Math.random() * 1200;
    setTimeout(() => {
      hideTyping();
      const category = classify(trimmed);
      const reply = pick(responses[category]);
      appendMessage('ai', reply);
    }, delay);
  }

  function toggleSendBtn() {
    const hasText = chatInput.value.trim().length > 0;
    sendBtn.classList.toggle('enabled', hasText);
    sendBtn.disabled = !hasText;
  }

  // ── Auto-resize textarea ──
  chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
    toggleSendBtn();
  });

  // ── Send on click ──
  sendBtn.addEventListener('click', () => handleSend(chatInput.value));

  // ── Send on Enter (Shift+Enter for newline) ──
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend(chatInput.value);
    }
  });

  // ── Quick-action chips ──
  quickActions.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (chip) handleSend(chip.dataset.prompt);
  });

  // ── New Chat ──
  function resetChat() {
    chatMessages.innerHTML = '';
    chatMessages.appendChild(welcomeCard);
    welcomeCard.style.display = '';
    welcomeCard.style.opacity = '1';
    welcomeCard.style.transform = '';
    hideTyping();
    chatInput.value = '';
    toggleSendBtn();
  }
  newChatBtn.addEventListener('click', resetChat);
  clearChatBtn.addEventListener('click', resetChat);

  // ── Sidebar Navigation ──
  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navLinks.forEach((l) => l.classList.remove('active'));
      link.classList.add('active');
      // Close mobile sidebar
      sidebar.classList.remove('open');
      overlay.classList.remove('active');
    });
  });

  // ── Mobile Sidebar ──
  mobileToggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('active');
  });
  overlay.addEventListener('click', () => {
    sidebar.classList.remove('open');
    overlay.classList.remove('active');
  });

  // ── Focus input on load ──
  chatInput.focus();
})();
