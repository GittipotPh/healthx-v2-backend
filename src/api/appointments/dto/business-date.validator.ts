import { ValidateBy, type ValidationOptions } from "class-validator";
import { isIsoBusinessDate } from "../../../common/business-date";

export function IsBusinessDate(
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: "isBusinessDate",
      validator: {
        validate: (value: unknown): boolean =>
          typeof value === "string" && isIsoBusinessDate(value),
        defaultMessage: (): string =>
          "$property must be a real calendar date in YYYY-MM-DD format",
      },
    },
    validationOptions,
  );
}
