-- #66 : `request_card_move` devient `request_card_change`, qui propose aussi la parente,
-- l'échéance et les liens « bloque ». Les demandes déjà déposées gardent leur sens.
UPDATE `agent_requests` SET `kind` = 'request_card_change' WHERE `kind` = 'request_card_move';
--> statement-breakpoint
-- Et la famille `cardFiling` s'allume par défaut (#66, tranché par Tim le 2026-10-24) :
-- les réglages enregistrés quand elle était éteinte par défaut l'écrivent en toutes
-- lettres, et garderaient sinon l'ancien défaut. Les conversations existantes ne
-- changent pas : leur réglage est celui qu'elles ont reçu au lancement.
UPDATE `user_settings` SET `data` = replace(`data`, '"cardFiling":false', '"cardFiling":true') WHERE `data` LIKE '%"cardFiling":false%';
--> statement-breakpoint
UPDATE `projects` SET `default_config` = replace(`default_config`, '"cardFiling":false', '"cardFiling":true') WHERE `default_config` LIKE '%"cardFiling":false%';
