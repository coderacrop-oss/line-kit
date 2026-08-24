'use client'

import { useState } from 'react'
import type { CSSProperties } from 'react'
import { Field } from '@/components/ui'
import {
  INPUT_TYPES, RESOLVE_METHODS, type InputType,
  inputTypeName, isComboAllowed, resolveMethodName,
} from '@/lib/activities/wizard'

const gridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }

/**
 * แกน 1 กับแกน 2 ของฟอร์มสร้างกิจกรรม · คอมโพเนนต์เดียวในจอสร้างที่มีสถานะฝั่งเบราว์เซอร์
 *
 * ควิซบุคลิกภาพ (personality_quiz) ไม่มี resolve_method เลย — ไม่ใช่แค่ผสมกับบางวิธี
 * ไม่ได้แบบที่ BR-36 ปฏิเสธบางคู่ของสี่ชนิดเดิม แต่คือไม่มีแกน 2 ให้เลือกด้วยเลยสักตัว
 * (0014_quiz_engine.sql บังคับ resolve_method เป็น NULL เฉพาะชนิดนี้) จอจึงต้องสลับ
 * ทั้งช่องแกน 2 ตามชนิดอินพุตที่เลือกสด ไม่ใช่แค่ปิดตัวเลือกบางอันในช่องเดิมเหมือนที่
 * BR-36 ทำกับสี่ชนิดที่เหลือ — ปุ่มวิทยุ/select ธรรมดาที่ไม่มี state ทำแบบนี้ไม่ได้
 *
 * lib/activities/wizard.ts จงใจไม่รู้จักควิซบุคลิกภาพในแง่นี้: fieldsFor()/isComboAllowed()
 * ยังรับได้แค่สี่ชนิดที่มี resolve_method จริง (อ่านเหตุผลเต็มที่คอมเมนต์ของ BY_INPUT ใน
 * ไฟล์นั้น) การแยกสาขานี้จึงต้องอยู่ที่นี่ ก่อนเรียก isComboAllowed() เลย ไม่ใช่สอนให้
 * wizard.ts รู้จักชนิดที่ไม่มีแกน 2
 */
export function CreateActivityAxes() {
  const [inputType, setInputType] = useState<InputType>('none')

  return (
    <div style={gridStyle}>
      <Field label="แกน 1 · รับอินพุตยังไง">
        <select
          name="input_type"
          value={inputType}
          onChange={(event) => setInputType(event.target.value as InputType)}
        >
          {INPUT_TYPES.map((type) => (
            <option key={type} value={type}>{inputTypeName(type)}</option>
          ))}
        </select>
      </Field>

      {inputType === 'personality_quiz' ? (
        <Field
          label="โหมด"
          hint="เดี่ยว = ตอบคนเดียวจบ · คู่ = รอจับคู่กับอีกคนก่อนตัดสินผล"
        >
          <select name="quiz_mode" defaultValue="solo">
            <option value="solo">เดี่ยว · Solo</option>
            <option value="duo">คู่ · Duo</option>
          </select>
        </Field>
      ) : (
        <Field
          label="แกน 2 · ตัดสินผลยังไง"
          hint="ตัวเลือกที่ผสมกันไม่ได้จะกดไม่ได้ (BR-36)"
        >
          <select name="resolve_method" defaultValue="weighted">
            {RESOLVE_METHODS.map((method) => (
              <option
                key={method}
                value={method}
                disabled={!isComboAllowed(inputType, method)}
              >
                {resolveMethodName(method)}
              </option>
            ))}
          </select>
        </Field>
      )}
    </div>
  )
}
