// Spielfeld, Karten und Spielfiguren – Bad Segeberg Edition
(function () {
  const GROUPS = {
    brown:     { color: '#8a4b2a', name: 'Altstadt-Rand', house: 50 },
    lightblue: { color: '#8fd3f2', name: 'Wohnviertel', house: 50 },
    pink:      { color: '#d6489a', name: 'Ausfallstraßen', house: 100 },
    orange:    { color: '#f39229', name: 'Villenviertel', house: 100 },
    red:       { color: '#e0352b', name: 'Innenstadt', house: 150 },
    yellow:    { color: '#f6d32d', name: 'Am See', house: 150 },
    green:     { color: '#21a35b', name: 'Wahrzeichen', house: 200 },
    darkblue:  { color: '#2c4fb8', name: 'Kalkberg', house: 200 },
  };

  const S = (name, group, price, rent) => ({ type: 'street', name, group, price, rent });
  const B = [
    { type: 'go', name: 'LOS', sub: 'Du erhältst 200 € beim Vorbeiziehen' },
    S('Burgfeldstraße', 'brown', 60, [2, 10, 30, 90, 160, 250]),
    { type: 'community', name: 'Gemeinschaftsfeld' },
    S('Ziegelstraße', 'brown', 60, [4, 20, 60, 180, 320, 450]),
    { type: 'tax', name: 'Einkommensteuer', amount: 200 },
    { type: 'station', name: 'Busbahnhof ZOB', price: 200 },
    S('Falkenburger Straße', 'lightblue', 100, [6, 30, 90, 270, 400, 550]),
    { type: 'chance', name: 'Ereignisfeld' },
    S('Theodor-Storm-Straße', 'lightblue', 100, [6, 30, 90, 270, 400, 550]),
    S('Christiansfelde', 'lightblue', 120, [8, 40, 100, 300, 450, 600]),
    { type: 'jail', name: 'Gefängnis', sub: 'Nur zu Besuch' },
    S('Hamburger Straße', 'pink', 140, [10, 50, 150, 450, 625, 750]),
    { type: 'utility', name: 'Stadtwerke Strom', price: 150, icon: '💡' },
    S('Kieler Straße', 'pink', 140, [10, 50, 150, 450, 625, 750]),
    S('Lübecker Straße', 'pink', 160, [12, 60, 180, 500, 700, 900]),
    { type: 'station', name: 'Bahnhof Bad Segeberg', price: 200 },
    S('Oldesloer Straße', 'orange', 180, [14, 70, 200, 550, 750, 950]),
    { type: 'community', name: 'Gemeinschaftsfeld' },
    S('Hamdorfer Weg', 'orange', 180, [14, 70, 200, 550, 750, 950]),
    S('Bismarckallee', 'orange', 200, [16, 80, 220, 600, 800, 1000]),
    { type: 'parking', name: 'Frei Parken', sub: 'am Segeberger See' },
    S('Kurhausstraße', 'red', 220, [18, 90, 250, 700, 875, 1050]),
    { type: 'chance', name: 'Ereignisfeld' },
    S('Kirchstraße', 'red', 220, [18, 90, 250, 700, 875, 1050]),
    S('Marktplatz', 'red', 240, [20, 100, 300, 750, 925, 1100]),
    { type: 'station', name: 'Haltepunkt Segeberg Süd', price: 200 },
    S('Kurpark', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
    S('Seepromenade', 'yellow', 260, [22, 110, 330, 800, 975, 1150]),
    { type: 'utility', name: 'Wasserwerk', price: 150, icon: '💧' },
    S('Großer Segeberger See', 'yellow', 280, [24, 120, 360, 850, 1025, 1200]),
    { type: 'gotojail', name: 'Gehe ins Gefängnis' },
    S('Marienkirche', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
    S('Großer Ihlsee', 'green', 300, [26, 130, 390, 900, 1100, 1275]),
    { type: 'community', name: 'Gemeinschaftsfeld' },
    S('Kalkberghöhle', 'green', 320, [28, 150, 450, 1000, 1200, 1400]),
    { type: 'station', name: 'Kalkberg-Bimmelbahn', price: 200 },
    { type: 'chance', name: 'Ereignisfeld' },
    S('Karl-May-Freilichtbühne', 'darkblue', 350, [35, 175, 500, 1100, 1300, 1500]),
    { type: 'tax', name: 'Kurtaxe', amount: 100 },
    S('Kalkberg', 'darkblue', 400, [50, 200, 600, 1400, 1700, 2000]),
  ];
  B.forEach((f, i) => { f.idx = i; if (f.type === 'street') f.house = GROUPS[f.group].house; });

  const groupMembers = {};
  B.forEach(f => { if (f.type === 'street') (groupMembers[f.group] = groupMembers[f.group] || []).push(f.idx); });

  // Karten: kind = Effekt, Werte nach offiziellem Regelwerk
  const CHANCE = [
    { text: 'Rücke vor bis auf LOS.', kind: 'moveTo', to: 0 },
    { text: 'Rücke vor bis zum Kalkberg. Die Aussicht ist unbezahlbar – die Miete nicht.', kind: 'moveTo', to: 39 },
    { text: 'Shoppingtour! Rücke vor bis zum Marktplatz. Kommst du über LOS, ziehe 200 € ein.', kind: 'moveTo', to: 24 },
    { text: 'Stau auf der B206. Rücke vor bis zur Hamburger Straße. Kommst du über LOS, ziehe 200 € ein.', kind: 'moveTo', to: 11 },
    { text: 'Rücke vor bis zum nächsten Bahnhof. Gehört er jemandem, zahle die doppelte Miete.', kind: 'nearestStation' },
    { text: 'Rücke vor bis zum nächsten Bahnhof. Gehört er jemandem, zahle die doppelte Miete.', kind: 'nearestStation' },
    { text: 'Rücke vor bis zum nächsten Werk. Gehört es jemandem, würfle und zahle das Zehnfache.', kind: 'nearestUtility' },
    { text: 'Die Sparkasse Südholstein zahlt dir eine Dividende von 50 €.', kind: 'money', amount: 50 },
    { text: 'Du kommst aus dem Gefängnis frei! Diese Karte darfst du behalten oder verkaufen.', kind: 'jailFree' },
    { text: 'Verlaufen im Kalkbergstadion. Gehe 3 Felder zurück.', kind: 'back', n: 3 },
    { text: 'Beim Schwarzangeln am Ihlsee erwischt. Gehe in das Gefängnis! Ziehe nicht über LOS.', kind: 'jail' },
    { text: 'Deine Häuser brauchen neue Reetdächer: Zahle 25 € pro Haus und 100 € pro Hotel.', kind: 'repairs', house: 25, hotel: 100 },
    { text: 'Zu schnell auf der Kurhausstraße geblitzt: Zahle 15 €.', kind: 'money', amount: -15 },
    { text: 'Ausflug mit dem Bus! Rücke vor bis zum Busbahnhof ZOB. Kommst du über LOS, ziehe 200 € ein.', kind: 'moveTo', to: 5 },
    { text: 'Du wirst Häuptling des Stadtfests und zahlst jedem Spieler 50 € für die Runde Bier.', kind: 'payEach', amount: 50 },
    { text: 'Dein Bausparvertrag wird fällig. Ziehe 150 € ein.', kind: 'money', amount: 150 },
  ];
  const COMMUNITY = [
    { text: 'Rücke vor bis auf LOS.', kind: 'moveTo', to: 0 },
    { text: 'Bankirrtum zu deinen Gunsten. Ziehe 200 € ein.', kind: 'money', amount: 200 },
    { text: 'Arztkosten nach dem Sturz von der Kalkbergtreppe: Zahle 50 €.', kind: 'money', amount: -50 },
    { text: 'Du verkaufst Fledermaus-Souvenirs an der Kalkberghöhle und erhältst 50 €.', kind: 'money', amount: 50 },
    { text: 'Du kommst aus dem Gefängnis frei! Diese Karte darfst du behalten oder verkaufen.', kind: 'jailFree' },
    { text: 'Gehe in das Gefängnis! Begib dich direkt dorthin. Ziehe nicht über LOS.', kind: 'jail' },
    { text: 'Du spielst als Statist bei den Karl-May-Spielen mit. Ziehe 100 € Gage ein.', kind: 'money', amount: 100 },
    { text: 'Einkommensteuer-Rückerstattung vom Finanzamt Bad Segeberg. Ziehe 20 € ein.', kind: 'money', amount: 20 },
    { text: 'Du hast Geburtstag! Jeder Spieler schenkt dir 10 €.', kind: 'collectEach', amount: 10 },
    { text: 'Deine Lebensversicherung wird fällig. Ziehe 100 € ein.', kind: 'money', amount: 100 },
    { text: 'Zahle das Segeberger Krankenhaus: 100 €.', kind: 'money', amount: -100 },
    { text: 'Zahle das Schulgeld für das Städtische Gymnasium: 50 €.', kind: 'money', amount: -50 },
    { text: 'Du gibst Segelkurse auf dem Großen See und erhältst 25 € Honorar.', kind: 'money', amount: 25 },
    { text: 'Straßenausbaubeitrag: Zahle 40 € pro Haus und 115 € pro Hotel.', kind: 'repairs', house: 40, hotel: 115 },
    { text: 'Zweiter Platz beim Segeberger Kürbisfest. Ziehe 10 € ein.', kind: 'money', amount: 10 },
    { text: 'Du erbst 100 € von Tante Erna aus Wahlstedt.', kind: 'money', amount: 100 },
  ];

  const TOKENS = [
    { id: 'hut',  name: 'Cowboyhut', emoji: '🤠' },
    { id: 'boot', name: 'Segelboot', emoji: '⛵' },
    { id: 'bat',  name: 'Fledermaus', emoji: '🦇' },
    { id: 'turm', name: 'Burgturm', emoji: '🏰' },
    { id: 'auto', name: 'Auto', emoji: '🚗' },
    { id: 'ente', name: 'Ente', emoji: '🦆' },
  ];
  const COLORS = ['#ff4d6d', '#3fa7ff', '#ffc233', '#2ee6a6', '#b57bff', '#ff8a3d'];

  window.SEG = { BOARD: B, GROUPS, groupMembers, CHANCE, COMMUNITY, TOKENS, COLORS,
    START_MONEY: 1500, GO_MONEY: 200, JAIL_FINE: 50, HOUSES: 32, HOTELS: 12 };
})();
