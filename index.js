const { S3Client, CopyObjectCommand } = require('@aws-sdk/client-s3'),
    sharp = require('sharp');

exports.handler = async (event) => {
    // Read data from event object.
    const region = event.Records[0].awsRegion
    const sourceBucket = event.Records[0].s3.bucket.name
    const sourceKey = event.Records[0].s3.object.key

    // Instantiate a new S3 client.
    const s3Client = new S3Client({
        region: region
    })

    // Create an object with parameters for CopyObjectCommand.
    const copyObjectParams = {
        Bucket: process.env.DEST_BUCKET,
        Key: sourceKey,
        CopySource: `${sourceBucket}/${sourceKey}`
    }
    // Execute object copy between buckets and return the result.
    return s3Client.send(new CopyObjectCommand(copyObjectParams))
}
