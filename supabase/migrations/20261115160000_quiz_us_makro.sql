-- Punkt D (Toby 15.11.2026): fuenf Quiz-Karten zu US-Makrodaten.
-- Inhalt wie lib/macroGuide.ts und Lernen -> Grundlagen -> US-Makrodaten.
-- Bestehende Tabelle (id ist identity), keine neuen Rechte noetig.
insert into public.quiz_cards (question, answer, explanation, category, active)
select * from (values
('Kern-CPI 0,3 % bei erwarteten 0,3 %. Was passiert?',
 'Meist wenig. Die Zahl war schon im Preis, es gibt keine Überraschung.',
 'Nur die Überraschung bewegt. Die Dochte kommen trotzdem, weil Stopps auf beiden Seiten abgeholt werden.',
 'US-Makrodaten', true),
('Kern-CPI 0,3 % bei erwarteten 0,2 %. Eher bullisch oder bärisch?',
 'Bärisch. Die Inflation ist heisser als erwartet.',
 'Die Fed bleibt länger streng, Dollar und Renditen steigen, es fliesst weniger Geld in BTC.',
 'US-Makrodaten', true),
('NFP sehr schwach. Warum kann das trotzdem bärisch sein?',
 'Zu schwach weckt Rezessionsangst.',
 'Dann fliehen Anleger aus Risiko, auch aus BTC, obwohl Zinssenkungen wahrscheinlicher werden.',
 'US-Makrodaten', true),
('Die Fed lässt die Zinsen unverändert, klingt aber streng. Was zählt?',
 'Der Ton. Ein unveränderter Zins mit strengem Ausblick (hawkish) wirkt eher bärisch.',
 'Beim FOMC zählt oft die Pressekonferenz ab 20:30 mehr als der Entscheid um 20:00. Veto bis 21:00.',
 'US-Makrodaten', true),
('Drei Minuten nach CPI sticht BTC nach oben. Einsteigen?',
 'Nein. Der erste Ausschlag ist oft falsch.',
 '15 bis 30 Minuten warten, Einstieg erst nach deinem normalen Ablauf mit 4H-Schluss. Am Datentag halbe Grösse.',
 'US-Makrodaten', true)
) as v(question, answer, explanation, category, active)
where not exists (select 1 from public.quiz_cards q where q.question = v.question);
