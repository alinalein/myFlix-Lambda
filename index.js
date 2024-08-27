const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');

exports.handler = async (event, context) => {
    try {
        // Read data from event object
        const region = event.Records[0].awsRegion;
        const sourceBucket = event.Records[0].s3.bucket.name;
        const sourceKey = event.Records[0].s3.object.key;
        const resizedImageHeight = 200;

        // Instantiate a new S3 client
        const s3Client = new S3Client({
            region: region
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

        const imageBuffer = await covertStreamToBuffer(downloadedImage.Body);

        // {ContentType}= downloadedImage.Body -> resultet in time out, body too big for this kind of search 
        const contentType = downloadedImage.ContentType;
        const originalMetadata = await sharp(imageBuffer).metadata()

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
        const resizedImage = await sharp(imageBuffer)
            .resize({ height: resizedImageHeight })
            // Makes sure Content-Type stays the same 
            .toBuffer();

        await uploadImage(s3Client, sourceBucket, sourceKey, resizedImage, contentType);

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

async function uploadImage(s3Client, sourceBucket, sourceKey, resizedImage, contentType) {
    // Otherwise in the folder resized-images the folder original-images will be created again
    const baseKey = sourceKey.replace('original-images/', '');
    const newKey = `resized-images/${baseKey.replace(/(\.[\w\d_-]+)$/i, '_resized$1')}`;

    const uploadObjectParams = {
        Bucket: sourceBucket,
        Key: newKey,
        Body: resizedImage,
        ContentType: contentType
    };

    // Upload resized object to the bucket
    await s3Client.send(new PutObjectCommand(uploadObjectParams));
    // the logs in CloudWatch only show console.log statements but not the return statemenst
    console.log(`Uploading image succeeded, ${newKey}`);
    return {
        statusCode: 200,
        body: JSON.stringify({ message: `Image ${newKey} resized and uploaded successfully` }),
        headers: {
            'Content-Type': 'application/json'
        }
    };
}

// Stream from downloaded image has to be converted to buffer so that sharp can use it
const covertStreamToBuffer = async (stream) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(chunk));
        stream.on('end', () => resolve(Buffer.concat(chunks)));
        stream.on('error', reject);
    });
};