/* =========================================================
   BloxBazaar BD — guides-data.js
   Game guide content. Informational only (PRD §3): no prices,
   no order actions — just official ways and safety notes.
   Links point at official Roblox pages.
   ========================================================= */

window.BB_GUIDES = {
  robux: {
    id: "robux",
    idx: 1,
    name: { en: "Robux", bn: "রোবাক্স" },
    monogram: "Rx",
    tone: "green",
    tagline: {
      en: "What Robux is and the official ways to get it — safely.",
      bn: "রোবাক্স কী এবং নিরাপদে এটি পাওয়ার অফিশিয়াল উপায়।"
    },
    intro: {
      en: "Robux is Roblox's platform currency. It can be bought or redeemed through official Roblox channels — and through independent resellers. Whoever you buy from, check them carefully and never share account credentials.",
      bn: "রোবাক্স হলো Roblox-এর প্লাটফর্ম কারেন্সি। এটি অফিশিয়াল Roblox চ্যানেলে — এবং স্বাধীন রিসেলারদের কাছেও কেনা বা রিডিম করা যায়। যে কারো কাছ থেকেই কেনেন, ভালোভাবে যাচাই করে নিন এবং কখনো অ্যাকাউন্টের তথ্য শেয়ার করবেন না।"
    },
    waysTitle: { en: "The official ways to get Robux", bn: "রোবাক্স পাওয়ার অফিশিয়াল উপায়" },
    ways: [
      {
        title: { en: "Buy on the official Roblox site", bn: "অফিশিয়াল Roblox সাইটে কিনুন" },
        desc: {
          en: "Purchase Robux directly from Roblox with a supported payment method on your own account.",
          bn: "নিজের অ্যাকাউন্টে সমর্থিত পেমেন্ট পদ্ধতিতে সরাসরি Roblox থেকে রোবাক্স কিনুন।"
        },
        link: "https://www.roblox.com/upgrades/robux",
        linkLabel: { en: "Open the official Robux page", bn: "অফিশিয়াল রোবাক্স পাতা খুলুন" }
      },
      {
        title: { en: "Redeem a Roblox gift card", bn: "Roblox গিফট কার্ড রিডিম করুন" },
        desc: {
          en: "Roblox gift cards from authorized retailers can be redeemed on your own account for Robux or credit.",
          bn: "অনুমোদিত বিক্রেতার Roblox গিফট কার্ড নিজের অ্যাকাউন্টে রোবাক্স বা ক্রেডিট হিসেবে রিডিম করা যায়।"
        },
        link: "https://www.roblox.com/giftcards",
        linkLabel: { en: "See official gift cards", bn: "অফিশিয়াল গিফট কার্ড দেখুন" }
      },
      {
        title: { en: "Buy inside the official Roblox app", bn: "অফিশিয়াল Roblox অ্যাপে কিনুন" },
        desc: {
          en: "You can also purchase Robux inside the official Roblox app through the App Store or Google Play.",
          bn: "App Store বা Google Play-তে অফিশিয়াল Roblox অ্যাপের ভেতর থেকেও রোবাক্স কেনা যায়।"
        }
      }
    ],
    safety: [
      { en: "Never share your password, email codes, or backup codes. Roblox support will never ask for them.", bn: "পাসওয়ার্ড, ইমেইল কোড বা ব্যাকআপ কোড কখনো শেয়ার করবেন না। Roblox সাপোর্ট কখনো এগুলো চায় না।" },
      { en: "Only work with sellers who ask for your username — never your password, codes, or account access.", bn: "শুধু সেই বিক্রেতার সাথে কাজ করুন যিনি শুধু ইউজারনেম চান — পাসওয়ার্ড, কোড বা অ্যাকাউন্ট অ্যাক্সেস কখনো নয়।" },
      { en: "Ignore “free Robux” generators and account-trading offers.", bn: "“ফ্রি রোবাক্স” জেনারেটর ও অ্যাকাউন্ট কেনাবেচার প্রস্তাব উপেক্ষা করুন।" }
    ],
    links: [
      { label: { en: "Roblox official site", bn: "Roblox অফিশিয়াল সাইট" }, url: "https://www.roblox.com", note: { en: "Buying and redeeming happens here, signed in to your own account.", bn: "কেনা ও রিডিম নিজের অ্যাকাউন্টে সাইন-ইন করে এখানেই হয়।" } },
      { label: { en: "Roblox Terms of Use", bn: "Roblox Terms of Use" }, url: "https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use", note: { en: "Roblox's platform rules — worth a read before buying from anyone.", bn: "Roblox-এর প্লাটফর্ম নিয়ম — কারো কাছ থেকে কেনার আগে পড়ে নেওয়া ভালো।" } }
    ],
    updated: "2026-10-12"
  },

  "blox-fruits": {
    id: "blox-fruits",
    idx: 2,
    name: { en: "Blox Fruits", bn: "Blox Fruits" },
    monogram: "BF",
    tone: "",
    tagline: {
      en: "How to play Blox Fruits and get its content through official channels.",
      bn: "কীভাবে Blox Fruits খেলবেন এবং অফিশিয়াল চ্যানেলে এর কনটেন্ট পাবেন।"
    },
    intro: {
      en: "Blox Fruits is an adventure experience on Roblox. In-game fruits, passes, and upgrades are sold inside the game, paid for with Robux bought through official Roblox channels.",
      bn: "Blox Fruits হলো Roblox-এর একটি অ্যাডভেঞ্চার গেম। ইন-গেম ফল, পাস ও আপগ্রেড গেমের ভেতরেই বিক্রি হয়, অফিশিয়াল Roblox চ্যানেলে কেনা Robux দিয়ে।"
    },
    waysTitle: { en: "The official ways to play and buy", bn: "খেলা ও কেনার অফিশিয়াল উপায়" },
    ways: [
      {
        title: { en: "Join the game on Roblox", bn: "Roblox-এ গেমে যোগ দিন" },
        desc: {
          en: "Open the official game page on roblox.com and start playing from your own account.",
          bn: "roblox.com-এ অফিশিয়াল গেম পাতা খুলে নিজের অ্যাকাউন্ট থেকে খেলা শুরু করুন।"
        },
        link: "https://www.roblox.com/discover/?Keyword=Blox%20Fruits",
        linkLabel: { en: "Find it on Roblox", bn: "Roblox-এ খুঁজুন" }
      },
      {
        title: { en: "Buy in-game content inside the experience", bn: "গেমের ভেতরেই কনটেন্ট কিনুন" },
        desc: {
          en: "Fruits and passes are purchased in-game with Robux. Check the in-game shop for current items and prices.",
          bn: "ফল ও পাস গেমের ভেতরে Robux দিয়ে কেনা হয়। চলমান আইটেম ও দাম গেমের শপে দেখুন।"
        }
      },
      {
        title: { en: "Get Robux officially first", bn: "প্রথমে অফিশিয়াল উপায়ে Robux নিন" },
        desc: {
          en: "However you spend Robux, get it through official Roblox channels — see our Robux guide.",
          bn: "Robux যেভাবেই খরচ করুন, অফিশিয়াল Roblox চ্যানেল থেকে নিন — আমাদের রোবাক্স গাইড দেখুন।"
        },
        internal: true,
        link: "guide-robux.html",
        linkLabel: { en: "Read the Robux guide", bn: "রোবাক্স গাইড পড়ুন" }
      }
    ],
    safety: [
      { en: "Prefer sellers who deliver in-game without asking for account access. Never share login details with anyone.", bn: "যে বিক্রেতা অ্যাকাউন্ট অ্যাক্সেস না চেয়ে ইন-গেমে ডেলিভারি দেন, তাঁকেই বেছে নিন। কারো সাথে লগইন তথ্য শেয়ার করবেন না।" },
      { en: "Trading with other players happens in-game only. Keep every trade inside Roblox.", bn: "খেলোয়াড়দের সাথে ট্রেড শুধু গেমের ভেতরেই হয়। সব ট্রেড Roblox-এর ভেতরে রাখুন।" },
      { en: "We never ask for your password or account access.", bn: "আমরা কখনো আপনার পাসওয়ার্ড বা অ্যাকাউন্ট অ্যাক্সেস চাই না।" }
    ],
    links: [
      { label: { en: "Blox Fruits on Roblox", bn: "Roblox-এ Blox Fruits" }, url: "https://www.roblox.com/discover/?Keyword=Blox%20Fruits", note: { en: "The official game page — start here.", bn: "অফিশিয়াল গেম পাতা — এখান থেকেই শুরু করুন।" } },
      { label: { en: "Roblox Terms of Use", bn: "Roblox Terms of Use" }, url: "https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use", note: { en: "Rules for buying and selling outside Roblox.", bn: "Roblox-এর বাইরে কেনা-বেচার নিয়ম।" } }
    ],
    updated: "2026-10-12"
  },

  mm2: {
    id: "mm2",
    idx: 3,
    name: { en: "Murder Mystery 2 (MM2)", bn: "Murder Mystery 2 (MM2)" },
    monogram: "M2",
    tone: "sand",
    tagline: {
      en: "Play MM2 safely and understand how its items actually work.",
      bn: "নিরাপদে MM2 খেলুন এবং এর আইটেমগুলো আসলে কীভাবে কাজ করে জানুন।"
    },
    intro: {
      en: "Murder Mystery 2 is a long-running round-based Roblox game where players collect and trade items. Items and crates are obtained inside the game with Robux bought officially.",
      bn: "Murder Mystery 2 একটি দীর্ঘদিনের রাউন্ড-ভিত্তিক Roblox গেম, যেখানে খেলোয়াড়রা আইটেম সংগ্রহ ও ট্রেড করে। আইটেম ও ক্রেট গেমের ভেতরেই অফিশিয়াল উপায়ে কেনা Robux দিয়ে পাওয়া যায়।"
    },
    waysTitle: { en: "The official ways to play and buy", bn: "খেলা ও কেনার অফিশিয়াল উপায়" },
    ways: [
      {
        title: { en: "Join the game on Roblox", bn: "Roblox-এ গেমে যোগ দিন" },
        desc: {
          en: "Open the official game page on roblox.com and play from your own account.",
          bn: "roblox.com-এ অফিশিয়াল গেম পাতা খুলে নিজের অ্যাকাউন্ট থেকে খেলুন।"
        },
        link: "https://www.roblox.com/discover/?Keyword=Murder%20Mystery%202",
        linkLabel: { en: "Find it on Roblox", bn: "Roblox-এ খুঁজুন" }
      },
      {
        title: { en: "Open crates and buy items in-game", bn: "গেমের ভেতরে ক্রেট খুলুন ও আইটেম কিনুন" },
        desc: {
          en: "Items, crates, and bundles are sold inside the game with Robux. Check the in-game shop for what is currently available.",
          bn: "আইটেম, ক্রেট ও বান্ডল গেমের ভেতরে Robux দিয়ে বিক্রি হয়। এখন কী পাওয়া যায় তা গেমের শপে দেখুন।"
        }
      },
      {
        title: { en: "Get Robux officially first", bn: "প্রথমে অফিশিয়াল উপায়ে Robux নিন" },
        desc: {
          en: "Any Robux you spend should come from official Roblox channels — see our Robux guide.",
          bn: "যে Robux-ই খরচ করুন, তা অফিশিয়াল Roblox চ্যানেল থেকে নিন — আমাদের রোবাক্স গাইড দেখুন।"
        },
        internal: true,
        link: "guide-robux.html",
        linkLabel: { en: "Read the Robux guide", bn: "রোবাক্স গাইড পড়ুন" }
      }
    ],
    safety: [
      { en: "Be careful with cross-trading and “trust” deals outside the game — they are the most common MM2 scam.", bn: "গেমের বাইরে ক্রস-ট্রেড ও “বিশ্বাস” চুক্তিতে সতর্ক থাকুন — MM2-তে এটাই সবচেয়ে সাধারণ প্রতারণা।" },
      { en: "Only trade using the in-game trading system. Never trade passwords or account access.", bn: "শুধু গেমের ট্রেডিং সিস্টেমে ট্রেড করুন। কখনো পাসওয়ার্ড বা অ্যাকাউন্ট অ্যাক্সেস ট্রেড করবেন না।" },
      { en: "We never ask for your password or account access.", bn: "আমরা কখনো আপনার পাসওয়ার্ড বা অ্যাকাউন্ট অ্যাক্সেস চাই না।" }
    ],
    links: [
      { label: { en: "Murder Mystery 2 on Roblox", bn: "Roblox-এ Murder Mystery 2" }, url: "https://www.roblox.com/discover/?Keyword=Murder%20Mystery%202", note: { en: "The official game page.", bn: "অফিশিয়াল গেম পাতা।" } },
      { label: { en: "Roblox Terms of Use", bn: "Roblox Terms of Use" }, url: "https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use", note: { en: "Rules for buying and selling outside Roblox.", bn: "Roblox-এর বাইরে কেনা-বেচার নিয়ম।" } }
    ],
    updated: "2026-10-12"
  },

  rivals: {
    id: "rivals",
    idx: 4,
    name: { en: "Rivals", bn: "Rivals" },
    monogram: "RV",
    tone: "",
    tagline: {
      en: "What to know before buying anything for Rivals.",
      bn: "Rivals-এর জন্য কিছু কেনার আগে যা জানা দরকার।"
    },
    intro: {
      en: "Rivals is a fast-paced shooter experience on Roblox. Weapons, passes, and cosmetic items are sold inside the game with Robux bought through official channels.",
      bn: "Rivals হলো Roblox-এর দ্রুতগতির শুটার গেম। অস্ত্র, পাস ও কসমেটিক আইটেম গেমের ভেতরেই বিক্রি হয়, অফিশিয়াল চ্যানেলে কেনা Robux দিয়ে।"
    },
    waysTitle: { en: "The official ways to play and buy", bn: "খেলা ও কেনার অফিশিয়াল উপায়" },
    ways: [
      {
        title: { en: "Join the game on Roblox", bn: "Roblox-এ গেমে যোগ দিন" },
        desc: {
          en: "Open the official game page on roblox.com and play from your own account.",
          bn: "roblox.com-এ অফিশিয়াল গেম পাতা খুলে নিজের অ্যাকাউন্ট থেকে খেলুন।"
        },
        link: "https://www.roblox.com/discover/?Keyword=Rivals",
        linkLabel: { en: "Find it on Roblox", bn: "Roblox-এ খুঁজুন" }
      },
      {
        title: { en: "Buy passes and items in-game", bn: "গেমের ভেতরে পাস ও আইটেম কিনুন" },
        desc: {
          en: "Passes and cosmetic content are purchased inside the experience. Check the in-game store for current items.",
          bn: "পাস ও কসমেটিক কনটেন্ট গেমের ভেতরে কেনা হয়। চলমান আইটেমের জন্য গেমের স্টোর দেখুন।"
        }
      },
      {
        title: { en: "Get Robux officially first", bn: "প্রথমে অফিশিয়াল উপায়ে Robux নিন" },
        desc: {
          en: "Get any Robux from official Roblox channels — see our Robux guide.",
          bn: "যে কোনো Robux অফিশিয়াল Roblox চ্যানেল থেকে নিন — আমাদের রোবাক্স গাইড দেখুন।"
        },
        internal: true,
        link: "guide-robux.html",
        linkLabel: { en: "Read the Robux guide", bn: "রোবাক্স গাইড পড়ুন" }
      }
    ],
    safety: [
      { en: "Never share account access for “boosting” or “cheap items” — it can get your account locked.", bn: "“বুস্টিং” বা “সস্তা আইটেম”-এর জন্য অ্যাকাউন্ট অ্যাক্সেস কখনো দেবেন না — অ্যাকাউন্ট লক হয়ে যেতে পারে।" },
      { en: "Keep every purchase inside the official game and Roblox store.", bn: "সব কেনাকাটা অফিশিয়াল গেম ও Roblox স্টোরের ভেতরেই রাখুন।" },
      { en: "We never ask for your password or account access.", bn: "আমরা কখনো আপনার পাসওয়ার্ড বা অ্যাকাউন্ট অ্যাক্সেস চাই না।" }
    ],
    links: [
      { label: { en: "Rivals on Roblox", bn: "Roblox-এ Rivals" }, url: "https://www.roblox.com/discover/?Keyword=Rivals", note: { en: "The official game page.", bn: "অফিশিয়াল গেম পাতা।" } },
      { label: { en: "Roblox Terms of Use", bn: "Roblox Terms of Use" }, url: "https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use", note: { en: "Rules for buying and selling outside Roblox.", bn: "Roblox-এর বাইরে কেনা-বেচার নিয়ম।" } }
    ],
    updated: "2026-10-12"
  },

  "steal-a-brainrot": {
    id: "steal-a-brainrot",
    idx: 5,
    name: { en: "Steal a Brainrot", bn: "Steal a Brainrot" },
    monogram: "SB",
    tone: "sand",
    tagline: {
      en: "Play Steal a Brainrot safely — and know what's official.",
      bn: "নিরাপদে Steal a Brainrot খেলুন — আর জানুন কোনটা অফিশিয়াল।"
    },
    intro: {
      en: "Steal a Brainrot is a hit Roblox game about collecting — and stealing — quirky characters. Characters, upgrades, and passes are obtained inside the game with Robux bought officially.",
      bn: "Steal a Brainrot হলো মজার চরিত্র সংগ্রহ — ও চুরি — নিয়ে এক জনপ্রিয় Roblox গেম। চরিত্র, আপগ্রেড ও পাস গেমের ভেতরেই পাওয়া যায়, অফিশিয়াল উপায়ে কেনা Robux দিয়ে।"
    },
    waysTitle: { en: "The official ways to play and buy", bn: "খেলা ও কেনার অফিশিয়াল উপায়" },
    ways: [
      {
        title: { en: "Join the game on Roblox", bn: "Roblox-এ গেমে যোগ দিন" },
        desc: {
          en: "Open the official game page on roblox.com and play from your own account.",
          bn: "roblox.com-এ অফিশিয়াল গেম পাতা খুলে নিজের অ্যাকাউন্ট থেকে খেলুন।"
        },
        link: "https://www.roblox.com/discover/?Keyword=Steal%20a%20Brainrot",
        linkLabel: { en: "Find it on Roblox", bn: "Roblox-এ খুঁজুন" }
      },
      {
        title: { en: "Get characters and upgrades in-game", bn: "গেমের ভেতরেই চরিত্র ও আপগ্রেড নিন" },
        desc: {
          en: "Everything is obtained by playing — or bought in-game with Robux. Check the in-game shop for official offers.",
          bn: "সবকিছু খেলে পাওয়া যায় — বা গেমের ভেতরে Robux দিয়ে কেনা যায়। অফিশিয়াল অফারের জন্য গেমের শপ দেখুন।"
        }
      },
      {
        title: { en: "Get Robux officially first", bn: "প্রথমে অফিশিয়াল উপায়ে Robux নিন" },
        desc: {
          en: "Use only Robux from official Roblox channels — see our Robux guide.",
          bn: "শুধু অফিশিয়াল Roblox চ্যানেলের Robux ব্যবহার করুন — আমাদের রোবাক্স গাইড দেখুন।"
        },
        internal: true,
        link: "guide-robux.html",
        linkLabel: { en: "Read the Robux guide", bn: "রোবাক্স গাইড পড়ুন" }
      }
    ],
    safety: [
      { en: "Only use sellers who deliver in-game and never ask for account access. If something feels off, walk away.", bn: "শুধু সেই বিক্রেতার সাথেই কাজ করুন যিনি ইন-গেমে ডেলিভারি দেন আর কখনো অ্যাকাউন্ট অ্যাক্সেস চান না। সন্দেহ হলে সরে যান।" },
      { en: "Popular games attract fake “free rewards” links. Only use what's inside the game.", bn: "জনপ্রিয় গেমে ভুয়া “ফ্রি রিওয়ার্ড” লিংক ছড়ায়। শুধু গেমের ভেতরের অফার ব্যবহার করুন।" },
      { en: "We never ask for your password or account access.", bn: "আমরা কখনো আপনার পাসওয়ার্ড বা অ্যাকাউন্ট অ্যাক্সেস চাই না।" }
    ],
    links: [
      { label: { en: "Steal a Brainrot on Roblox", bn: "Roblox-এ Steal a Brainrot" }, url: "https://www.roblox.com/discover/?Keyword=Steal%20a%20Brainrot", note: { en: "The official game page.", bn: "অফিশিয়াল গেম পাতা।" } },
      { label: { en: "Roblox Terms of Use", bn: "Roblox Terms of Use" }, url: "https://en.help.roblox.com/hc/en-us/articles/115004647846-Roblox-Terms-of-Use", note: { en: "Rules for buying and selling outside Roblox.", bn: "Roblox-এর বাইরে কেনা-বেচার নিয়ম।" } }
    ],
    updated: "2026-10-12"
  }
};
