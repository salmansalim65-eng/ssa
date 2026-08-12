-- Group (header) cost centres. A group organises other cost centres under it
-- (e.g. a "Properties" group with country subgroups) and is not a postable cost
-- centre itself. Hierarchy still uses parent_id; is_group just marks the node
-- as a folder so non-asset cost centres can be organised into groups.

alter table accounting.cost_centers
  add column if not exists is_group boolean not null default false;
