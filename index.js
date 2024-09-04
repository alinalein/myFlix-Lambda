const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const sharp = require('sharp');

exports.handler = async (event, context) => {

    // Read data from event object
    const region = event.Records[0].awsRegion;
    const sourceBucket = event.Records[0].s3.bucket.name;
    const sourceKey = event.Records[0].s3.object.key;
    const resizedImageHeight = 200;

    // Instantiate a new S3 client
    const s3Client = new S3Client({
        region: region
    });

    // Early exit if the file is an .avif to prevent sharp from processing it
    if (!sourceKey || sourceKey.includes('resized__') || sourceKey.endsWith('.avif')) {
        console.log(`Skipping unsupported or already processed image: ${sourceKey}`);
        return { statusCode: 200, body: JSON.stringify({ message: 'No action required.' }) };
    }
    try {
        const downloadedImage = await downloadImage(s3Client, sourceBucket, sourceKey);

        const imageBuffer = await covertStreamToBuffer(downloadedImage.Body);

        // {ContentType}= downloadedImage.Body -> resultet in time out, body too big for this kind of search 
        const contentType = downloadedImage.ContentType;

        // console.log('Extracting image metadata...');
        // const originalMetadata = await sharp(imageBuffer).metadata()
        // To prevent multiple timeouts of the function if the format of the downloaded file cannot be proceed

        // Images with height up to 150 will be proceed
        // if (originalMetadata.height < 150) {
        //     console.log(`Skipping processing as image is too small, height: ${originalMetadata.height}, ${sourceKey}`);
        //     return {
        //         statusCode: 400,
        //         body: JSON.stringify({ message: `Image ${sourceKey} is too small to be resized, height: ${originalMetadata.height}` }),
        //         headers: {
        //             'Content-Type': 'application/json'
        //         }
        //     };
        // }

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
    return await s3Client.send(new GetObjectCommand(getObjectParams));
}

async function uploadImage(s3Client, sourceBucket, sourceKey, resizedImage, contentType) {
    // Otherwise in the folder resized-images the folder original-images will be created again
    const newKey = `resized-images/resized__${sourceKey.replace('original-images/', '')}`;

    const uploadObjectParams = {
        Bucket: sourceBucket,
        Key: newKey,
        Body: resizedImage,
        CacheControl: 'no-cache, must-revalidate',
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