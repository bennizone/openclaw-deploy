# Learnings — ha-integration

<!-- LEARNING
     component: ha-integration
     trigger: WebSearch-Aufruf auf developer.home-assistant.io URLs
     type: api
     recommendation: MiniMax WebSearch API wirft 400 invalid params bei exakten URLs. WebSearch nur für allgemeine Suchbegriffe. Für exakte Dokumentationsrecherche immer WebFetch mit korrekter Basis-URL nutzen, keine fragmentierten Anchor-URLs.
     validated: true
     date: 2026-04-04
-->
- **type:** api (Trigger: WebSearch-Aufruf auf developer.home-assistant.io URLs)

<!-- LEARNING
     component: ha-integration
     trigger: 20+ WebFetch-Aufrufe, alle 404 auf developer.home-assistant.io
     type: anti-pattern
     recommendation: Anchor-URLs auf developer.home-assistant.io existieren nicht als eigenstaendige Seiten. Nach dem ersten 404 URL-Strategie wechseln. 9B-Modell wiederholt fehlgeschlagene Strategien ohne Adaption. Fuer HA-Dokumentation: lokale Dateien lesen (components/ha-integration/, docs/), nicht Web.
     validated: true
     date: 2026-04-04
-->
- **type:** anti-pattern (Trigger: 20+ WebFetch-Aufrufe, alle 404 auf developer.home-assistant.io)

<!-- LEARNING
     component: ha-integration
     trigger: Sub-Agent fuer Web-Recherche lieferte nichts (25k Cache-Tokens verbraucht)
     type: anti-pattern
     recommendation: Sub-Agenten (Explore) fuer Web-Recherche nur starten wenn vorherige WebSearch/WebFetch erfolgreich waren. Nicht blind delegieren. Bei HA-Themen immer zuerst lokale Dateien pruefen.
     validated: true
     date: 2026-04-04
-->
- **type:** anti-pattern (Trigger: Sub-Agent fuer Web-Recherche lieferte nichts (25k Cache-Tokens verbraucht))
