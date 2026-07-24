export const OPD_CHART_TEMPLATE_VERSION = "healthx-chart-template-v1";
export const OPD_CHART_CANVAS_WIDTH = 960;
export const OPD_CHART_CANVAS_HEIGHT = 680;

export enum OpdChartTemplateCode {
  MALE_FACE_FRONT = "male-face-front",
  MALE_FACE_LEFT = "male-face-left",
  MALE_FACE_RIGHT = "male-face-right",
  FEMALE_FACE_FRONT = "female-face-front",
  DENTAL_MAP = "dental-map",
  BODY_FRONT_BACK = "body-front-back",
  SKIN_LESION = "skin-lesion",
  SURGERY_MARKING = "surgery-marking",
}

export interface OpdChartTemplateDefinition {
  code: OpdChartTemplateCode;
  version: typeof OPD_CHART_TEMPLATE_VERSION;
  name: string;
  category: string;
  sample: string;
  canvasWidth: typeof OPD_CHART_CANVAS_WIDTH;
  canvasHeight: typeof OPD_CHART_CANVAS_HEIGHT;
}

const template = (
  code: OpdChartTemplateCode,
  name: string,
  category: string,
  sample: string,
): OpdChartTemplateDefinition => ({
  code,
  version: OPD_CHART_TEMPLATE_VERSION,
  name,
  category,
  sample,
  canvasWidth: OPD_CHART_CANVAS_WIDTH,
  canvasHeight: OPD_CHART_CANVAS_HEIGHT,
});

export const OPD_CHART_TEMPLATES: readonly OpdChartTemplateDefinition[] = [
  template(
    OpdChartTemplateCode.MALE_FACE_FRONT,
    "ใบหน้าผู้ชาย — ด้านหน้า",
    "ใบหน้า",
    "ด้านหน้า",
  ),
  template(
    OpdChartTemplateCode.MALE_FACE_LEFT,
    "ใบหน้าผู้ชาย — ด้านซ้าย",
    "ใบหน้า",
    "ด้านซ้าย",
  ),
  template(
    OpdChartTemplateCode.MALE_FACE_RIGHT,
    "ใบหน้าผู้ชาย — ด้านขวา",
    "ใบหน้า",
    "ด้านขวา",
  ),
  template(
    OpdChartTemplateCode.FEMALE_FACE_FRONT,
    "ใบหน้าผู้หญิง — ด้านหน้า",
    "ใบหน้า",
    "ด้านหน้า",
  ),
  template(
    OpdChartTemplateCode.DENTAL_MAP,
    "ช่องปากและฟัน — แผนผังฟัน",
    "ช่องปากและฟัน",
    "Dental chart",
  ),
  template(
    OpdChartTemplateCode.BODY_FRONT_BACK,
    "ร่างกาย — ด้านหน้าและด้านหลัง",
    "ร่างกาย",
    "หน้า/หลัง",
  ),
  template(
    OpdChartTemplateCode.SKIN_LESION,
    "ผิวหนัง — รอยโรคเฉพาะจุด",
    "ผิวหนัง",
    "Lesion map",
  ),
  template(
    OpdChartTemplateCode.SURGERY_MARKING,
    "ศัลยกรรม — Pre-op Marking",
    "ศัลยกรรม",
    "Marking",
  ),
];

const OPD_CHART_TEMPLATE_BY_CODE = new Map(
  OPD_CHART_TEMPLATES.map((entry) => [entry.code, entry]),
);

export function findOpdChartTemplate(
  code: OpdChartTemplateCode,
): OpdChartTemplateDefinition | undefined {
  return OPD_CHART_TEMPLATE_BY_CODE.get(code);
}
