-- Currency conversion must accept at least 6 decimal places for accurate
-- accounting (e.g. 0.012987, 0.000001). Every exchange_rate column is already
-- numeric(18,6); the one exception is the asset-sale PAK conversion factor,
-- which was numeric(18,4) and silently rounded 5-6 dp inputs. Widen it to
-- numeric(18,6) to match. Widening scale is loss-free for existing values.
alter table assets.asset_sales
  alter column pak_exch type numeric(18,6);
