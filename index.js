const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');

exports.handler = async (event, context) => {
    try {
        // Read data from event object
        const region = event.Records[0].awsRegion;
        const sourceBucket = event.Records[0].s3.bucket.name;
        const sourceKey = event.Records[0].s3.object.key;
        const resizedImageHeight = 100;

        // Instantiate a new S3 client
        const s3Client = new S3Client({
            region: region,
            endpoint: 'http://localhost:4566',
            forcePathStyle: true
        });

        if (!sourceKey) {
            console.error(`Error: Source key is not defined.`);
            return {
                statusCode: 400,
                body: JSON.stringify({ error: 'Failed to process the image due to undefined source key.' }),
                headers: {
                    'Content-Type': 'application/json'
                }
            };
        }

        if (sourceKey.includes('_resized')) {
            console.log(`Skipping processing for already resized image: ${sourceKey}`);
            return {
                statusCode: 200,
                body: JSON.stringify({ message: `Image ${sourceKey} is already resized.` }),
                headers: {
                    'Content-Type': 'application/json'
                }
            };
        }

        const downloadedImage = await downloadImage(s3Client, sourceBucket, sourceKey);

        const originalMetadata = await sharp(downloadedImage.Body).metadata();

        // Check if image is too small to be resized
        if (originalMetadata.height < resizedImageHeight) {
            console.log(`Skipping processing as image is too small, height: ${originalMetadata.height}`);
            return {
                statusCode: 400,
                body: JSON.stringify({ message: `Image is too small to be resized, height: ${originalMetadata.height}` }),
                headers: {
                    'Content-Type': 'application/json'
                }
            };
        }

        // Resize the image
        const resizedImage = await sharp(downloadedImage.Body)
            .resize({ height: resizedImageHeight })
            // Makes sure Content-Type stays the same 
            .toBuffer();

        await uploadImage(s3Client, sourceBucket, sourceKey, resizedImage);

        return {
            statusCode: 200,
            body: JSON.stringify({ message: `Image resized and uploaded successfully` }),
            headers: {
                'Content-Type': 'application/json'
            }
        };


    } catch (error) {
        console.error('Error resizing image:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'Failed to resize the image' })
        };
    }
};
async function downloadImage(s3Client, sourceBucket, sourceKey) {
    // Create an object with parameters for GetObjectCommand
    const getObjectParams = {
        Bucket: sourceBucket,
        Key: sourceKey
    };

    // Get object/image from bucket and return the result
    const downloadedImage = await s3Client.send(new GetObjectCommand(getObjectParams));
    return downloadedImage;
}

async function uploadImage(s3Client, sourceBucket, sourceKey, resizedImage) {
    // Create an object with parameters for PutObjectCommand
    const newKey = sourceKey.replace(/(\.[\w\d_-]+)$/i, '_resized$1');

    const uploadObjectParams = {
        Bucket: sourceBucket,
        Key: newKey,
        Body: resizedImage
    };

    // Upload resized object to the bucket
    await s3Client.send(new PutObjectCommand(uploadObjectParams));
}