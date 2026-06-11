// 媒体对象存储（S3 兼容，本地 MinIO）。本体存对象存储、元数据存 PG media 表；
// 私有桶：外界一律经 /api/media/<hash> 代理读取，不直连对象存储。
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

let client: S3Client | undefined;

function s3(): S3Client {
  if (client === undefined) {
    client = new S3Client({
      endpoint: process.env.S3_ENDPOINT ?? 'http://localhost:9000',
      region: process.env.S3_REGION ?? 'us-east-1',
      // MinIO 需要 path-style 寻址（非虚拟主机式）
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID ?? 'harublog',
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? 'harublog-minio-secret',
      },
    });
  }
  return client;
}

function bucket(): string {
  return process.env.S3_BUCKET ?? 'harublog-media';
}

/** 上传一个对象（key = 内容地址 hash）；幂等：同 hash 覆盖写同样字节。 */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<void> {
  await s3().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  );
}

export interface FetchedObject {
  body: Uint8Array;
  contentType: string;
}

/** 取一个对象（供 /api/media 代理）；不存在抛错由路由转 404。 */
export async function getObject(key: string): Promise<FetchedObject> {
  const res = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  const body = await res.Body?.transformToByteArray();
  if (body === undefined) {
    throw new Error('对象为空');
  }
  return { body, contentType: res.ContentType ?? 'application/octet-stream' };
}
