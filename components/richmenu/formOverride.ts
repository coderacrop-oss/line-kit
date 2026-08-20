/**
 * "ไฟล์ที่จะส่งจริงตอน submit ไม่ใช่ไฟล์ในช่อง input เดิม" — ใช้กับภาพที่ตัด/ครอปมา
 * จาก CropModal ก่อนอัปโหลด (ดู ActionForm.tsx/ImagePicker.tsx)
 *
 * ไม่ใช้ React Context เพราะ ImagePicker กับ <form> ที่ห่อโดย ActionForm ไม่ได้อยู่
 * ในสาย React tree เดียวกันเสมอไป — จอ Rich Menu ผูกช่องนอกฟอร์มเข้ากับฟอร์มด้วย
 * attribute `form=` ของ HTML (เหมือน alias/area select ทำอยู่แล้ว) ไม่ใช่การซ้อน JSX
 * Context จะไม่ไหลข้ามจุดนั้น แต่ DOM ผูกกันจริงอยู่แล้วผ่าน id ของฟอร์ม จึงใช้ WeakMap
 * คีย์ด้วยตัว `<form>` element ตรงๆ แทน — ใช้ได้ทั้งกรณีซ้อนอยู่ในฟอร์มจริงๆ และกรณี
 * ผูกด้วย `form=` จากนอกฟอร์ม เพราะ `input.form` คืนอิลิเมนต์ฟอร์มเจ้าของเสมอไม่ว่า
 * จะผูกแบบไหน
 */

export type FormOverride = { field: string; file: File }

const registry = new WeakMap<HTMLFormElement, FormOverride>()

export function setFormOverride(form: HTMLFormElement | null | undefined, override: FormOverride | null): void {
  if (!form) return
  if (override) registry.set(form, override)
  else registry.delete(form)
}

export function getFormOverride(form: HTMLFormElement | null | undefined): FormOverride | null {
  if (!form) return null
  return registry.get(form) ?? null
}
