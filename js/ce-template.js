// Шаблон базы Car Expenses 30.87 (схема БД версии 29 и стандартное меню приложения).
// Взят из резервной копии CE; личных данных не содержит.

export const CE_DB_VERSION = 29;
export const CE_APP_VERSION = '30.87';

export const CE_SCHEMA = [
 "CREATE TABLE android_metadata (locale TEXT)",
 "CREATE TABLE fuel_table(_id integer primary key autoincrement, name text default '', parse text default '', tank_numb integer default 0,last_price float default 0,color integer default 0)",
 "CREATE TABLE money_table(_id integer primary key autoincrement, name text default '', unit text default '', order_currency integer default 0,equal float default 0,equal_orig float default 0)",
 "CREATE TABLE veh_table(_id integer primary key autoincrement, name text default '',comment text default '',avatar integer default 0,mil_unit integer default 0,vol_unit integer default 0,volmil_unit integer default 0,currency text default '',order_currency integer default 0,miladd_method integer default 0,tank_count integer default 0,tank_main integer default 2,tank_volume float default 0,tank_volume_rest float default 0,tank_volume_1 float default 0,tank_volume_rest_1 float default 0,sell_date integer default 0,buy_date integer default 0,sell_price float default 0,buy_price float default 0,sell_mileage integer default 0,buy_mileage integer default 0,veh_manufacturer text default '',veh_model text default '',veh_modification text default '',veh_equipment text default '',veh_birthday integer default 0,veh_vin text default '',veh_body integer default 0,veh_color integer default 0,engine_volume integer default 0,engine_type integer default 0,tm_type integer default 0,mil_coef float default 1,w_def integer default 185,h_def integer default 55,r_def integer default 15,w_set integer default 185,h_set integer default 55,r_set integer default 15,coef_a integer default 0,coef_b float default 1,coef_c integer default 0,coef_date integer default 0,oil_capacity text default '',oil_type text default '',brake_fluid_capacity text default '',brake_fluid_type text default '',coolant_capacity text default '',coolant_type text default '',key_code text default '',mms_code text default '',tire_pressure_before text default '',tire_pressure_behind text default '',buy_calc integer default 1,sell_calc integer default 1,last_mileage integer default 1,last_date integer default 1)",
 "CREATE TABLE image_table(_id integer primary key autoincrement, id_object integer default 0,type_object integer default 0,note text default '',image BLOB )",
 "CREATE TABLE sett_table(_id integer primary key autoincrement, id_vehicle integer default 0, type integer default 0, place integer default 0, position integer default 0, updated integer default 0, value string default '')",
 "CREATE TABLE menu_table(_id integer primary key autoincrement, id_parent integer default 0, type integer default 0, action integer default 0, enabled integer default 0, need_check integer default 0, lock integer default 0, base integer default 0, visible integer default 0, position integer default 0, notify_count integer default 0, title string default '', subtitle string default '', avatar string default '')",
 "CREATE TABLE pat_table(_id integer primary key autoincrement, name text default '', comment text default '', avatar integer default 0, id_category integer, period_type integer default 0, period_mileage integer default 0, period_month float default 0, period_mileage_once integer default 0, period_date_once integer default 0, event_show integer default 0, expense_when integer default 0, expense_type integer default 1, id_vehicle integer default 0, fuel_includes integer default 0, period_from_first integer default 0, period_done integer default 0 )",
 "CREATE TABLE cat_table(_id integer primary key autoincrement, name text default '', comment text default '', expense_type integer default 1, color integer default 0, stat_included integer default 0, fuel_includes integer default 0 )",
 "CREATE TABLE exp_table(_id integer primary key autoincrement, id_vehicle integer, date integer default 0, mileage integer default 0, name text default '', note text default '',total_costpart float default 0, total_costwork float default 0, predicated_mileage integer default 0)",
 "CREATE TABLE part_table(_id integer primary key autoincrement, id_vehicle integer, id_category integer, name text default '', comment text default '',avatar integer default 0,reusable integer default 0,recycle_mileage integer default 0,basic_mileage integer default 0, installed_at_puchase integer default 0, show_at_events_always integer default 0, total_mileage integer default 0, deprecation integer default 0 )",
 "CREATE TABLE note_table(_id integer primary key autoincrement, date integer default 0, id_vehicle integer default 0, mileage integer default 0, note text default '',comment text default '',color integer default 0,period_type integer default 0, period_mileage integer default 0, period_month float default 0, period_mileage_once integer default 0, period_date_once integer default 0, event_show integer default 0 )",
 "CREATE TABLE event_table(_id integer primary key autoincrement, note text default '',color integer default 0,avatar integer default 0, event_src integer default 0, id_vehicle integer default 0, parent_id integer default 0, period_last_mileage integer default 0, period_last_date integer default 0, period_future_mileage integer default 0, period_future_date integer default 0, resource integer default 0, exp_count integer default 0, diff_mileage integer default 0, diff_date integer default 0, diff_date_neg integer default 0, progress integer default 0, sort_level integer default 0 )",
 "CREATE TABLE exp_part_table(_id integer primary key autoincrement, id_expense integer default 0, id_part integer default 0, comment text default '', costpart float default 0, costwork float default 0,count_in float default 0, count_out float default 0, installed integer default 0 )",
 "CREATE TABLE exp_pat_table(_id integer primary key autoincrement, id_expense integer default 0, id_pattern integer default 0, costpart float default 0, costwork float default 0,note text default '')",
 "CREATE TABLE notify_table(_id integer primary key autoincrement, note text default '',color integer default 0,avatar integer default 0, event_src integer default 0, id_vehicle integer default 0, parent_id integer default 0, mileage integer default 0, date integer default 0, datetime integer default 0, notify_type integer default 0, notify_when integer default 0, notify_shown integer default 0, notify_id integer default 0, missed integer default 0 )",
 "CREATE TABLE cal_table(_id integer primary key autoincrement, id_index integer default 0 , account_name text default '', calendar_display_name text default '', owner_account text default '',account_type text default '' )",
 "CREATE TABLE rec_table(_id integer primary key autoincrement, date integer default 0,id_vehicle integer default 0,note text default '',mileage integer default 0,volume float default 0,volumecost float default 0,cost float default 0,type text default '',id_fueltype integer default 0,mark integer default 0,mileageadd integer default 0,current_tank integer default 0,used_tank integer default 0,tankvolume float default 0,volumemileage float default 0,costmileage float default 0,volumemileage_1 float default 0,costmileage_1 float default 0,mil_coef float default 1,missed integer default 0)"
];

export const CE_MENU_COLUMNS = ["_id", "id_parent", "type", "action", "enabled", "need_check", "lock", "base", "visible", "position", "notify_count", "title", "subtitle", "avatar"];
export const CE_MENU = [
  [1, 0, 1, 112, 1, 0, 1, 1, 1, 0, 0, "Главная", "", "ic_menu_dashboard"],
  [2, 0, 3, 0, 1, 0, 0, 0, 1, 1, 0, "Мои данные", "", "ic_menu_data"],
  [3, 2, 1, 65, 1, 0, 0, 0, 1, 0, 0, "Транспорт", "", "ic_menu_vehicles"],
  [4, 2, 1, 56, 1, 0, 0, 0, 1, 0, 0, "Виды топлива", "", "ic_menu_fuel_types"],
  [5, 2, 1, 57, 1, 0, 0, 0, 1, 0, 0, "Другие валюты", "", "ic_menu_money_types"],
  [6, 2, 1, 52, 1, 0, 0, 0, 1, 0, 0, "Категории трат", "", "ic_menu_categories"],
  [7, 2, 1, 60, 1, 0, 0, 0, 1, 0, 0, "Шаблоны трат", "", "ic_menu_patterns"],
  [8, 2, 1, 59, 1, 0, 0, 0, 1, 0, 0, "Запчасти", "", "ic_menu_parts"],
  [9, 0, 3, 0, 1, 0, 0, 0, 1, 2, 0, "Записи", "", "ic_menu_records"],
  [10, 9, 1, 51, 1, 0, 0, 0, 1, 0, 0, "Расходы", "", "ic_menu_non_profit"],
  [11, 9, 1, 55, 1, 0, 0, 0, 1, 0, 0, "Доходы", "", "ic_menu_profit"],
  [12, 9, 1, 62, 1, 0, 0, 0, 1, 0, 0, "Заправки", "", "ic_menu_refills"],
  [13, 9, 1, 58, 1, 0, 0, 0, 1, 0, 0, "Заметки", "", "ic_menu_notes"],
  [14, 0, 3, 0, 1, 0, 0, 0, 1, 3, 0, "Статистика", "", "ic_menu_stat"],
  [15, 14, 1, 53, 1, 0, 0, 0, 1, 0, 0, "События", "", "ic_menu_events"],
  [16, 14, 1, 114, 1, 0, 0, 0, 1, 0, 0, "Статистика - Расходы", "", "ic_menu_stat_expenses"],
  [17, 14, 1, 115, 1, 0, 0, 0, 1, 0, 0, "Статистика - Заправки", "", "ic_menu_stat_refills"],
  [18, 14, 1, 110, 1, 0, 0, 0, 1, 0, 0, "Графики - Расходы", "", "ic_menu_chart_expenses"],
  [19, 14, 1, 111, 1, 0, 0, 0, 1, 0, 0, "Графики - Заправки", "", "ic_menu_chart_refills"],
  [20, 14, 1, 63, 1, 0, 0, 0, 1, 0, 0, "Отчеты - Расходы", "", "ic_menu_report_expenses"],
  [21, 14, 1, 64, 1, 0, 0, 0, 1, 0, 0, "Отчеты - Заправки", "", "ic_menu_report_refills"],
  [22, 0, 3, 0, 1, 0, 0, 0, 1, 4, 0, "Инструменты", "", "ic_menu_tools"],
  [23, 22, 1, 50, 1, 0, 0, 0, 1, 0, 0, "Калькулятор - Расход топлива", "", "ic_menu_calculator"],
  [24, 22, 2, 9, 1, 0, 0, 0, 1, 0, 0, "Страхование со скидкой", "", "ic_menu_intouch"],
  [25, 0, 2, 5, 1, 0, 0, 0, 1, 5, 0, "Поддержать проект", "", "ic_menu_discount"],
  [26, 0, 3, 0, 1, 0, 1, 0, 1, 6, 0, "Настройки и управление", "", "ic_menu_settings"],
  [27, 26, 2, 6, 1, 0, 0, 0, 1, 0, 0, "Настройки приложения", "", "ic_menu_settings"],
  [28, 26, 2, 10, 1, 0, 0, 0, 1, 0, 0, "Настройка меню", "", "ic_menu_tune"],
  [29, 26, 2, 1, 1, 0, 0, 0, 1, 0, 0, "Резервное копирование", "", "ic_menu_backup"],
  [30, 26, 2, 4, 1, 0, 0, 0, 1, 0, 0, "Настройки напоминаний", "", "ic_menu_alarm"],
  [31, 26, 2, 2, 1, 0, 0, 0, 1, 0, 0, "Синхронизация с Dropbox", "", "ic_menu_dropbox"],
  [32, 26, 2, 3, 1, 0, 0, 0, 1, 0, 0, "Синхронизация с Google Drive", "", "ic_menu_google_drive"],
  [33, 26, 2, 7, 1, 0, 0, 0, 1, 0, 0, "Справка", "", "ic_menu_help"],
  [34, 26, 2, 40, 1, 0, 0, 0, 1, 0, 0, "Отзыв", "", "ic_menu_mail"],
  [35, 22, 2, 11, 1, 0, 0, 0, 1, 1, 0, "Запись на СТО (Ремонтиста)", "", "ic_menu_intouch"]
];
