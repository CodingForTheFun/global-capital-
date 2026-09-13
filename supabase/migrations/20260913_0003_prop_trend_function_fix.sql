create or replace function public.autoscout_refresh_prop_trend(p_prop_id text)
returns void language plpgsql security definer set search_path=public as $$
declare
 p public.active_props%rowtype; opp text; total integer := 0; avg_value numeric;
 l5 numeric; l10 numeric; l15 numeric; season_over numeric; season_under numeric; h2h numeric; streak_value integer := 0;
begin
 select * into p from public.active_props where id=p_prop_id;
 if not found or p.is_alternate then return; end if;
 select case when e.home_team=pl.team then e.away_team else e.home_team end into opp
 from public.events e left join public.players pl on pl.id=p.player_id where e.id=p.event_id;

 with usable as (
   select g.game_date,g.opponent,public.autoscout_stat_value(g.stats,p.stat_type) value,
          row_number() over(order by g.game_date desc) rn
   from public.player_game_logs g where g.player_id=p.player_id
 ), valid as (select * from usable where value is not null)
 select count(*),avg(value),
   100.0*count(*) filter(where value>p.target_line and rn<=5)/nullif(count(*) filter(where rn<=5),0),
   100.0*count(*) filter(where value>p.target_line and rn<=10)/nullif(count(*) filter(where rn<=10),0),
   100.0*count(*) filter(where value>p.target_line and rn<=15)/nullif(count(*) filter(where rn<=15),0),
   100.0*count(*) filter(where value>p.target_line)/nullif(count(*),0),
   100.0*count(*) filter(where value<p.target_line)/nullif(count(*),0),
   100.0*count(*) filter(where value>p.target_line and upper(coalesce(opponent,''))=upper(coalesce(opp,'')))/nullif(count(*) filter(where upper(coalesce(opponent,''))=upper(coalesce(opp,''))),0)
 into total,avg_value,l5,l10,l15,season_over,season_under,h2h from valid;

 with ordered as (
   select public.autoscout_stat_value(g.stats,p.stat_type) value,
          row_number() over(order by g.game_date desc) rn
   from public.player_game_logs g where g.player_id=p.player_id
 ), valid as (select * from ordered where value is not null), marked as (
   select *,sum(case when value>p.target_line then 0 else 1 end) over(order by rn) stop from valid
 ) select count(*) into streak_value from marked where stop=0;

 insert into public.prop_trends(prop_id,player_id,stat_type,target_line,l5_hit_rate,l10_hit_rate,l15_hit_rate,season_hit_rate,h2h_hit_rate,season_average,active_streak,over_probability,under_probability,sample_size,data_quality,calculated_at)
 values(p.id,p.player_id,p.stat_type,p.target_line,l5,l10,l15,season_over,h2h,avg_value,streak_value,season_over,season_under,total,
   case when total>=15 then 'HIGH' when total>=8 then 'MEDIUM' when total>=3 then 'LOW' else 'UNAVAILABLE' end,now())
 on conflict(prop_id) do update set target_line=excluded.target_line,l5_hit_rate=excluded.l5_hit_rate,l10_hit_rate=excluded.l10_hit_rate,l15_hit_rate=excluded.l15_hit_rate,season_hit_rate=excluded.season_hit_rate,h2h_hit_rate=excluded.h2h_hit_rate,season_average=excluded.season_average,active_streak=excluded.active_streak,over_probability=excluded.over_probability,under_probability=excluded.under_probability,sample_size=excluded.sample_size,data_quality=excluded.data_quality,calculated_at=excluded.calculated_at;
end $$;
