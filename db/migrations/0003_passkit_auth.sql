-- Apple PassKit web service auth (T9). Every .pkpass embeds an
-- authenticationToken; the device echoes it back on the web-service calls as
-- `Authorization: ApplePass <token>`. The token belongs to the pass (not the
-- registration), so it lives on passes. Generated lazily on first .pkpass
-- build; null for passes that never downloaded an Apple pass.
alter table passes add column apple_auth_token text;
