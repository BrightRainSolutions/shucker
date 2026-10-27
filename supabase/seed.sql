-- Shucker seed data. Not a migration.
-- Apply to the linked project with:  npx supabase db push --include-seed
-- Oyster coordinates are bay-level approximations (location_approx = true).
-- Place coordinates were looked up in OpenStreetMap (Nominatim) at build time.

insert into public.places (name, city, address, url, lat, lng) values
  ('Jax Fish House & Oyster Bar', 'Fort Collins, CO', '123 N College Ave, Fort Collins, CO 80524',
   'https://www.jaxfishhouse.com/location/jax-fort-collins/', 40.587641, -105.077320),
  ('Elliott''s Oyster House', 'Seattle, WA', 'Pier 56, 1201 Alaskan Way, Seattle, WA 98101',
   'https://www.elliottsoysterhouse.com/', 47.605464, -122.340924)
on conflict do nothing;

insert into public.oysters
  (name, grower, growing_area, region, country, species, cultivation, lat, lng, location_approx)
values
  -- Hood Canal
  ('Hama Hama',            'Hama Hama Oyster Co.',     'Hood Canal',          'Puget Sound',      'USA',    'pacific',  'beach',     47.535, -123.040, true),
  ('Blue Pool',            'Hama Hama Oyster Co.',     'Hood Canal',          'Puget Sound',      'USA',    'pacific',  'tumbled',   47.535, -123.040, true),
  ('Baywater Sweet',       'Baywater Shellfish',       'Hood Canal',          'Puget Sound',      'USA',    'pacific',  'tumbled',   47.805, -122.735, true),
  ('Dabob Bay',            null,                       'Dabob Bay',           'Puget Sound',      'USA',    'pacific',  'beach',     47.735, -122.830, true),
  ('Quilcene',             null,                       'Quilcene Bay',        'Puget Sound',      'USA',    'pacific',  'beach',     47.790, -122.860, true),
  -- South Puget Sound
  ('Kumamoto',             'Taylor Shellfish Farms',   'Totten Inlet',        'Puget Sound',      'USA',    'kumamoto', 'suspended', 47.165, -122.975, true),
  ('Totten Inlet Virginica','Taylor Shellfish Farms',  'Totten Inlet',        'Puget Sound',      'USA',    'atlantic', 'suspended', 47.165, -122.975, true),
  ('Olympia',              'Taylor Shellfish Farms',   'Totten Inlet',        'Puget Sound',      'USA',    'olympia',  'beach',     47.165, -122.975, true),
  ('Chelsea Gem',          'Chelsea Farms',            'Eld Inlet',           'Puget Sound',      'USA',    'pacific',  'tumbled',   47.100, -122.965, true),
  ('Barron Point',         'Hama Hama Oyster Co.',     'Totten Inlet',        'Puget Sound',      'USA',    'pacific',  'bag-to-beach', 47.130, -123.075, true),
  ('Pickering Passage',    null,                       'Pickering Passage',   'Puget Sound',      'USA',    'pacific',  'beach',     47.275, -122.900, true),
  ('Treasure Cove',        null,                       'Case Inlet',          'Puget Sound',      'USA',    'pacific',  'beach',     47.375, -122.830, true),
  -- North Puget Sound
  ('Penn Cove Select',     'Penn Cove Shellfish',      'Penn Cove',           'Puget Sound',      'USA',    'pacific',  'suspended', 48.220, -122.700, true),
  ('Samish Bay',           'Taylor Shellfish Farms',   'Samish Bay',          'Puget Sound',      'USA',    'pacific',  'beach',     48.580, -122.470, true),
  ('Snow Creek',           null,                       'Discovery Bay',       'Puget Sound',      'USA',    'pacific',  'suspended', 48.020, -122.850, true),
  -- Washington coast
  ('Shigoku',              'Taylor Shellfish Farms',   'Willapa Bay',         'Washington Coast', 'USA',    'pacific',  'tumbled',   46.550, -123.980, true),
  ('Goose Point',          'Goose Point Oysters',      'Willapa Bay',         'Washington Coast', 'USA',    'pacific',  'bottom',    46.620, -123.930, true),
  -- British Columbia
  ('Kusshi',               'Stellar Bay Shellfish',    'Deep Bay',            'British Columbia', 'Canada', 'pacific',  'tumbled',   49.465, -124.730, true),
  ('Fanny Bay',            'Fanny Bay Oysters',        'Baynes Sound',        'British Columbia', 'Canada', 'pacific',  'beach',     49.500, -124.810, true),
  ('Royal Miyagi',         null,                       'Cortes Island',       'British Columbia', 'Canada', 'pacific',  'suspended', 50.080, -124.950, true),
  ('Effingham',            null,                       'Barkley Sound',       'British Columbia', 'Canada', 'pacific',  'suspended', 49.000, -125.150, true),
  ('Sunseeker',            null,                       'Baynes Sound',        'British Columbia', 'Canada', 'pacific',  'suspended', 49.500, -124.810, true),
  -- California
  ('Kumamoto',             'Humboldt Bay Oyster Co.',  'Humboldt Bay',        'Northern California','USA',  'kumamoto', 'suspended', 40.780, -124.200, true),
  ('Hog Island Sweetwater','Hog Island Oyster Co.',    'Tomales Bay',         'Northern California','USA',  'pacific',  'suspended', 38.160, -122.900, true),
  -- East Coast
  ('Wellfleet',            null,                       'Wellfleet Harbor',    'Cape Cod',         'USA',    'atlantic', 'bottom',    41.920, -70.040,  true),
  ('Island Creek',         'Island Creek Oysters',     'Duxbury Bay',         'Massachusetts',    'USA',    'atlantic', 'bottom',    42.030, -70.660,  true),
  ('Duxbury Pearl',        null,                       'Duxbury Bay',         'Massachusetts',    'USA',    'atlantic', 'suspended', 42.030, -70.660,  true),
  ('Blue Point',           null,                       'Great South Bay',     'Long Island',      'USA',    'atlantic', 'bottom',    40.720, -73.030,  true),
  ('Glidden Point',        'Glidden Point Oyster Farms','Damariscotta River', 'Maine',            'USA',    'atlantic', 'bottom',    44.000, -69.540,  true),
  ('Rappahannock River',   'Rappahannock Oyster Co.',  'Rappahannock River',  'Chesapeake Bay',   'USA',    'atlantic', 'suspended', 37.700, -76.400,  true),
  ('Beausoleil',           null,                       'Miramichi Bay',       'New Brunswick',    'Canada', 'atlantic', 'suspended', 47.240, -65.070,  true),
  ('Malpeque',             null,                       'Malpeque Bay',        'Prince Edward Island','Canada','atlantic','bottom',   46.550, -63.730,  true)
on conflict do nothing;

-- Oysterater links (optional; shown on oyster detail)
update public.oysters set oysterater_url = 'https://oysterater.com/oyster/barron-point'
where lower(name) = 'barron point' and oysterater_url is null;
