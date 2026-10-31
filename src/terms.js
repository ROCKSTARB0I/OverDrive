// Terms & Agreement: shown over the main menu until the player scrolls to the end and accepts.
// Bump TERMS_VERSION whenever the text changes so everyone sees it again.
export const TERMS_VERSION = 1;

const TERMS = [
  ['1. Acceptance of These Terms', `These Terms & Agreement ("Terms") are a binding agreement between you and Ruff Dogs Studios ("Ruff Dogs", "we", "us") covering your use of OVERDRIVE (the "Game"), including its single-player modes, online features, accounts, lobbies, chat, voice chat and any related services. By selecting "I ACCEPT" you confirm that you have read, understood and agree to these Terms. If you do not agree, do not play the Game.`],
  ['2. Who May Play', `You must be at least 13 years old to create an account or use online features. If you are under the age of majority where you live, you may only use the Game with the involvement of a parent or legal guardian who has read and agreed to these Terms on your behalf. You are responsible for making sure your use of the Game is legal where you live.`],
  ['3. Licence to Play', `Ruff Dogs grants you a limited, personal, non-exclusive, non-transferable, revocable licence to play the Game for your own non-commercial entertainment. You may not copy, sell, rent, sublicense, reverse engineer (except where the law allows), modify, or create derivative works from the Game, and you may not use the Game for any commercial purpose without our written permission.`],
  ['4. Ownership & Copyright', `OVERDRIVE, including its software, code, car designs, tracks, artwork, logos, user interface, sound effects and studio intro, is © 2026 Ruff Dogs Studios. All rights reserved. The Ruff Dogs name and logo are ours. Nothing in these Terms transfers ownership of the Game or any part of it to you.`],
  ['5. Music Copyright Notice', `Music played on the Game's in-game radio stations is NOT owned by Ruff Dogs Studios. Each song is copyrighted by its respective artists, songwriters, labels and publishers, and all rights in that music belong to its original creators and rights holders. Ruff Dogs claims no ownership of, and no affiliation with or endorsement by, any artist or rights holder. You may not extract, record, copy or redistribute music from the Game. If you are a rights holder and want a song removed, contact us and we will remove it promptly.`],
  ['6. Accounts', `You can play without an account, but your progress is only saved to the cloud if you create one. You agree to give accurate information, keep your password private, and not share your account. You are responsible for everything that happens under your account. Usernames must not impersonate anyone, contain hate speech, slurs, sexual content, or personal information such as your full name, address or phone number. We may rename or remove accounts that break these rules.`],
  ['7. Profile Pictures & User Content', `You may upload a profile picture and post text in chat ("User Content"). You keep any rights you have in your User Content, but you give Ruff Dogs a worldwide, royalty-free licence to store, display and transmit it as needed to run the Game (for example, showing your picture on your profile and in lobbies). Only upload images you own or have permission to use. Do not upload anything violent, sexual, hateful, illegal, or that shows another person without their consent. We may remove any User Content at any time.`],
  ['8. Online Play, Lobbies & Invites', `Online features let you see other players, view their profiles, invite them to lobbies and race them. Other players are not controlled by Ruff Dogs and we are not responsible for what they say or do. Do not send spam invites, harass players who decline, or use lobbies to organise cheating. Online features may be unavailable at times, and we may change or end them without notice.`],
  ['9. Text Chat & Voice Chat', `Chat and voice chat are for friendly racing banter. You agree not to harass, bully, threaten, or discriminate against anyone; not to share other people's personal information; not to post sexual or graphic content; and not to scam, advertise or spam. Voice chat uses your microphone only after you switch it on and your browser asks for permission. Voice audio is sent directly between players in a lobby and is not recorded or stored by Ruff Dogs. You can mute any player at any time. Text chat messages pass through our server and may be logged briefly to enforce these Terms.`],
  ['10. Fair Play', `Do not cheat, exploit bugs, use bots or modified clients, tamper with save data or leaderboards, or interfere with other players' games or with our servers. We may reset progress, remove results, or suspend accounts that we reasonably believe are cheating.`],
  ['11. Street Cash & Virtual Items', `Street cash, cars, paint, wheels, stripes and upgrades are virtual items with no real-world monetary value. They cannot be sold, traded for money, or exchanged outside the Game. We may adjust prices, rewards and balance at any time to keep the Game fun and fair.`],
  ['12. Privacy', `If you create an account we store your username, a securely hashed version of your password (never the password itself), your profile picture, your game progress and basic match results. We use this only to run the Game: saving progress, showing profiles and rankings, and operating lobbies and chat. We do not sell your information. Settings such as volume and controls are stored in your own browser. You can ask us to delete your account and its data at any time.`],
  ['13. Safety & Reporting', `If another player makes you feel unsafe or breaks these Terms, leave the lobby, mute them, and tell us. Never agree to meet someone you only know from the Game, and never share passwords, addresses, phone numbers or payment details in chat. Parents and guardians can ask us to remove a child's account at any time.`],
  ['14. Suspension & Termination', `We may suspend or end your access to online features, or delete your account, if you break these Terms or if we need to for legal or safety reasons. You may stop playing and delete your account whenever you like. Sections 4, 5, 7, 11, 15, 16 and 17 continue to apply after your access ends.`],
  ['15. Disclaimers', `The Game is provided "as is" and "as available". OVERDRIVE is a fictional racing game: all cars, drivers, places and brands in it are invented, and any resemblance to real ones is coincidental. Nothing in the Game encourages real-world street racing. Always drive safely and legally. To the fullest extent the law allows, Ruff Dogs makes no warranties of any kind, including that the Game will be error-free, uninterrupted, or that your progress will never be lost.`],
  ['16. Limitation of Liability', `To the fullest extent the law allows, Ruff Dogs will not be liable for any indirect, incidental, special or consequential damages, or for any loss of data, progress or virtual items, arising from your use of the Game. Some places do not allow these limits, so they may not apply to you; in that case our liability is limited to the smallest amount the law permits.`],
  ['17. Changes to These Terms', `We may update these Terms as the Game changes. When we do, the new version will appear the next time you open the Game and you will need to accept it to keep playing. If you do not agree to an updated version, stop using the Game.`],
  ['18. Contact', `Questions, rights-holder requests, safety reports or account deletion requests can be sent to Ruff Dogs Studios through the contact details published with the Game.`],
];

export function termsAccepted() {
  try { return +localStorage.getItem('overdrive_terms') >= TERMS_VERSION; } catch (e) { return false; }
}

// Shows the agreement. Resolves when accepted. The Accept button stays locked until the text is scrolled to the end.
export function showTerms({ readOnly = false, click } = {}) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.id = 'terms';
    wrap.innerHTML = `<div class="tbox">
      <h2>TERMS <span>&amp; AGREEMENT</span></h2>
      <div class="tsub">OVERDRIVE &middot; RUFF DOGS STUDIOS &middot; VERSION ${TERMS_VERSION}</div>
      <div class="tscroll">${TERMS.map(([h, p]) => `<h4>${h}</h4><p>${p}</p>`).join('')}
        <p class="tend">By selecting I ACCEPT you agree to all of the Terms above.</p></div>
      <div class="tfoot"><span class="thint">${readOnly ? '' : 'Scroll to the end to continue'}</span>
        ${readOnly ? '<button class="tok">CLOSE</button>' : '<button class="tno">DECLINE</button><button class="tok" disabled>I ACCEPT</button>'}</div></div>`;
    document.body.appendChild(wrap);
    const sc = wrap.querySelector('.tscroll'), ok = wrap.querySelector('.tok'), hint = wrap.querySelector('.thint');
    const check = () => {
      if (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 8) { ok.disabled = false; hint.textContent = ''; }
    };
    sc.addEventListener('scroll', check);
    // stop the menu underneath from reacting to clicks/keys while this is up
    for (const ev of ['pointerdown', 'click', 'wheel', 'keydown']) wrap.addEventListener(ev, e => e.stopPropagation());
    ok.addEventListener('click', () => {
      click && click();
      if (!readOnly) try { localStorage.setItem('overdrive_terms', TERMS_VERSION); } catch (e) { }
      wrap.classList.add('gone'); setTimeout(() => wrap.remove(), 400); resolve(true);
    });
    const no = wrap.querySelector('.tno');
    if (no) no.addEventListener('click', () => {
      click && click();
      hint.textContent = 'You need to accept the Terms to play OVERDRIVE.';
      hint.classList.add('warn');
    });
  });
}
