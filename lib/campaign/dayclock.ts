/**
 * Turn the two fields that decide "once per day" into a sentence.
 *
 * Nobody can predict what a timezone plus a day length does to a limit by
 * reading the numbers, and getting it wrong means a player who plays at 00:30 is
 * counted into the next day. The screen says the consequence out loud.
 *
 * The three branches are the three branches of periodKey() in lib/daykey, and
 * they have to stay that way. A sentence describing one rule while the engine
 * counts by another is worse than no sentence — it is a confident wrong answer.
 */
export function describeDayClock(timezone: string, dayLengthSec: number): string {
  if (dayLengthSec <= 0) {
    return 'จำกัดตลอดแคมเปญ — เล่นได้ครั้งเดียวตลอด ไม่นับใหม่รายวัน'
  }
  if (dayLengthSec >= 86_400) {
    return `หนึ่งวันตัดที่เที่ยงคืนตามเขตเวลา ${timezone} — คนที่เล่นตอน 00:30 นับเป็นวันใหม่แล้ว`
  }
  // ปัดขึ้นอย่างน้อยหนึ่งนาที · "สะสม 7 วันจบได้ใน 0 นาที" ไม่ได้บอกอะไรใคร
  const minutesForSevenDays = Math.round((dayLengthSec * 7) / 60) || 1
  return `หนึ่งวันยาว ${dayLengthSec} วินาที — สำหรับเดโม่ ทำให้สะสม 7 วันจบได้ใน ${minutesForSevenDays} นาที`
}
