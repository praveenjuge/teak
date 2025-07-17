import type { Context, Next } from 'hono';

export interface UploadedFileData {
  file: File;
  fieldName: string;
}

declare module 'hono' {
  interface ContextVariableMap {
    uploadedFiles: UploadedFileData[];
  }
}

export async function fileUploadMiddleware(c: Context, next: Next) {
  const contentType = c.req.header('content-type');

  if (!contentType?.includes('multipart/form-data')) {
    // Not a file upload request, continue normally
    return next();
  }

  try {
    const formData = await c.req.formData();
    const uploadedFiles: UploadedFileData[] = [];

    for (const [fieldName, value] of formData.entries()) {
      if (
        value &&
        typeof value === 'object' &&
        'name' in value &&
        'size' in value &&
        'type' in value
      ) {
        uploadedFiles.push({
          file: value as File,
          fieldName,
        });
      }
    }

    // Store uploaded files in context
    c.set('uploadedFiles', uploadedFiles);

    // Also store form data for easy access to other fields
    c.set('formData', formData);
  } catch (error) {
    console.error('File upload middleware error:', error);
    return c.json({ error: 'Failed to process file upload' }, 400);
  }

  return next();
}

export function getUploadedFile(
  c: Context,
  fieldName: string
): File | undefined {
  const uploadedFiles = c.get('uploadedFiles') || [];
  return uploadedFiles.find((f) => f.fieldName === fieldName)?.file;
}

export function getFormField(
  c: Context,
  fieldName: string
): string | undefined {
  const formData = c.get('formData') as FormData;
  if (!formData) {
    return;
  }

  const value = formData.get(fieldName);
  return typeof value === 'string' ? value : undefined;
}
