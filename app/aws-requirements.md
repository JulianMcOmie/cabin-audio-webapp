# Cabin Audio - AWS Implementation Requirements

## Overview

This document outlines the AWS services and configurations required to implement the backend for the Cabin Audio web application. This serves as a guide for developers setting up the AWS infrastructure.

## Core AWS Services Required

### 1. Authentication & User Management

**Amazon Cognito**
- User Pool for authentication and identity management
- Configuration:
  - Email or username sign-in
  - OAuth2/JWT token generation
  - Password policies (8+ chars, special characters)
  - Email verification
  - Optional: Social identity providers (Google, Apple)
- Cognito identity pool for fine-grained AWS service access

### 2. API Layer

**Amazon API Gateway**
- REST API to expose all backend functionality
- Configuration:
  - JWT Authorizer connected to Cognito
  - CORS enabled for web application domain
  - Resource paths for tracks, albums, artists, playlists, EQ profiles
  - Rate limiting (suggest 100 req/sec to start)
  - Optional: Custom domain with SSL certificate
  - CloudWatch logging for API calls

### 3. Business Logic

**AWS Lambda**
- Functions to handle all API operations
- Required Functions:
  - Authentication operations (verify, refresh)
  - CRUD operations for tracks, albums, artists, playlists
  - CRUD operations for EQ profiles
  - File upload URL generation
  - File download URL generation
- Configuration:
  - Node.js 18+ runtime
  - 256MB-512MB memory allocation
  - 30-second timeout (15 seconds for most functions)
  - IAM roles with least privilege access to required resources

### 4. Data Storage

**Amazon DynamoDB**
- NoSQL database for application data
- Required Tables:
  - Users - user profile data
  - Tracks - track metadata
  - Albums - album information
  - Artists - artist information
  - Playlists - playlist definitions
  - EQProfiles - saved EQ settings
- Configuration for each table:
  - On-demand capacity mode for v1 (switch to provisioned later)
  - Global secondary indexes for common queries
  - TTL for any temporary data
  - Point-in-time recovery enabled
  - All items must include a `lastModified` timestamp

### 5. File Storage

**Amazon S3**
- Object storage for audio files and images
- Required Buckets:
  - `cabin-audio-tracks` - For audio files
  - `cabin-audio-images` - For album artwork and other images
- Configuration:
  - Private access (no public access)
  - CORS configuration to allow web application access
  - Server-side encryption enabled
  - Lifecycle rules:
    - Free tier: No expiration
    - Premium: No expiration
    - Trial accounts: 30-day expiration for unused files
  - Optional: S3 Transfer Acceleration for large file uploads

### 6. CDN (Optional for v1)

**Amazon CloudFront**
- Content delivery network for improved download performance
- Configuration:
  - Origin access identity for S3 access
  - HTTPS required
  - Cache behaviors optimized for audio files
  - Geographic restrictions based on business requirements

## API Endpoints Required

### Authentication Endpoints
- `POST /auth/register` - User registration
- `POST /auth/login` - User authentication
- `POST /auth/refresh` - Token refresh
- `POST /auth/logout` - User logout

### Track Endpoints
- `GET /tracks` - List tracks (with filtering/pagination)
- `GET /tracks/{id}` - Get track metadata
- `POST /tracks` - Create track
- `PUT /tracks/{id}` - Update track
- `DELETE /tracks/{id}` - Delete track
- `GET /tracks/{id}/download` - Generate pre-signed URL for download

### Album Endpoints
- `GET /albums` - List albums
- `GET /albums/{id}` - Get album details
- `POST /albums` - Create album
- `PUT /albums/{id}` - Update album
- `DELETE /albums/{id}` - Delete album
- `POST /albums/{id}/cover` - Upload album artwork

### Artist Endpoints
- `GET /artists` - List artists
- `GET /artists/{id}` - Get artist details
- `POST /artists` - Create artist
- `PUT /artists/{id}` - Update artist
- `DELETE /artists/{id}` - Delete artist

### Playlist Endpoints
- `GET /playlists` - List playlists
- `GET /playlists/{id}` - Get playlist details
- `POST /playlists` - Create playlist
- `PUT /playlists/{id}` - Update playlist
- `DELETE /playlists/{id}` - Delete playlist
- `PUT /playlists/{id}/tracks` - Update tracks in playlist

### EQ Profile Endpoints
- `GET /eq-profiles` - List EQ profiles
- `GET /eq-profiles/{id}` - Get profile details
- `POST /eq-profiles` - Create profile
- `PUT /eq-profiles/{id}` - Update profile
- `DELETE /eq-profiles/{id}` - Delete profile

## DynamoDB Schema Design

### Users Table
- Partition Key: `userId` (string)
- Attributes:
  - `email` (string)
  - `displayName` (string)
  - `createdAt` (number - timestamp)
  - `lastModified` (number - timestamp)
  - `subscription` (string - "free", "premium")
  - `settings` (map - user preferences)

### Tracks Table
- Partition Key: `userId` (string)
- Sort Key: `trackId` (string)
- Attributes:
  - `title` (string)
  - `artistId` (string)
  - `albumId` (string)
  - `duration` (number)
  - `trackNumber` (number)
  - `year` (number)
  - `genre` (string)
  - `storageKey` (string - S3 object key)
  - `coverStorageKey` (string - S3 object key)
  - `lastModified` (number - timestamp)
- GSI1: `artistId-lastModified-index` 
  - PK: `artistId`
  - SK: `lastModified`
- GSI2: `albumId-trackNumber-index`
  - PK: `albumId`
  - SK: `trackNumber`

### Albums Table
- Partition Key: `userId` (string)
- Sort Key: `albumId` (string)
- Attributes:
  - `title` (string)
  - `artistId` (string)
  - `year` (number)
  - `coverStorageKey` (string - S3 object key)
  - `lastModified` (number - timestamp)
- GSI1: `artistId-lastModified-index`
  - PK: `artistId`
  - SK: `lastModified`

### Artists Table
- Partition Key: `userId` (string)
- Sort Key: `artistId` (string)
- Attributes:
  - `name` (string)
  - `lastModified` (number - timestamp)

### Playlists Table
- Partition Key: `userId` (string)
- Sort Key: `playlistId` (string)
- Attributes:
  - `name` (string)
  - `trackIds` (string set - set of track IDs)
  - `lastModified` (number - timestamp)

### EQProfiles Table
- Partition Key: `userId` (string)
- Sort Key: `profileId` (string)
- Attributes:
  - `name` (string)
  - `bands` (list - EQ band settings)
  - `isDefault` (boolean)
  - `lastModified` (number - timestamp)

## S3 Configuration Details

### CORS Configuration (for both buckets)
```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST", "DELETE"],
    "AllowedOrigins": ["https://yourcabinaudioapp.com"],
    "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

### S3 Bucket Policy (example for tracks bucket)
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "AWS": "arn:aws:iam::123456789012:role/cabin-audio-lambda-role"
      },
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject"
      ],
      "Resource": "arn:aws:s3:::cabin-audio-tracks/*"
    }
  ]
}
```

## Implementation Notes

### Pre-signed URL Generation
- Use S3 pre-signed URLs for secure file uploads/downloads
- Set expiration to 15 minutes for security
- Example Lambda code:

```javascript
const AWS = require('aws-sdk');
const s3 = new AWS.S3();

exports.handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;
  const trackId = event.pathParameters.id;
  
  // Get track from DynamoDB to verify ownership
  // ... (code to fetch track and verify user access)
  
  const params = {
    Bucket: 'cabin-audio-tracks',
    Key: `${userId}/${track.storageKey}`,
    Expires: 900, // 15 minutes
    ResponseContentDisposition: `attachment; filename="${track.title}.mp3"`
  };
  
  const url = s3.getSignedUrl('getObject', params);
  
  return {
    statusCode: 200,
    body: JSON.stringify({ downloadUrl: url })
  };
};
```

### Conditional Updates for Conflict Management
Use conditional expressions in DynamoDB to detect conflicts:

```javascript
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB.DocumentClient();

exports.handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;
  const trackId = event.pathParameters.id;
  const trackData = JSON.parse(event.body);
  const clientTimestamp = trackData.lastModified;
  
  try {
    const result = await dynamodb.update({
      TableName: 'Tracks',
      Key: { userId, trackId },
      UpdateExpression: 'set title = :title, artistId = :artistId, /* other attributes */, lastModified = :newTimestamp',
      ConditionExpression: 'lastModified = :clientTimestamp',
      ExpressionAttributeValues: {
        ':title': trackData.title,
        ':artistId': trackData.artistId,
        /* other values */
        ':newTimestamp': Date.now(),
        ':clientTimestamp': clientTimestamp
      },
      ReturnValues: 'ALL_NEW'
    }).promise();
    
    return {
      statusCode: 200,
      body: JSON.stringify(result.Attributes)
    };
  } catch (error) {
    if (error.code === 'ConditionalCheckFailedException') {
      // Handle conflict - return current server version
      // Client will need to decide how to resolve
      // ...
    }
    // Handle other errors
  }
};
```

## Deployment Strategy

### CloudFormation / AWS SAM
- Use infrastructure as code to define all resources
- Create separate stacks for different environments (dev/staging/prod)
- Include all required resources:
  - Cognito pools
  - API Gateway
  - Lambda functions
  - DynamoDB tables
  - S3 buckets
  - IAM roles and policies

### CI/CD Pipeline
- Use AWS CodePipeline or GitHub Actions
- Automated testing before deployment
- Staged deployments (dev -> staging -> production)

## Monitoring and Maintenance

### CloudWatch
- Set up metrics and alarms for:
  - API Gateway 4xx/5xx errors
  - Lambda errors and timeouts
  - DynamoDB throttling events
  - S3 access patterns

### AWS X-Ray
- Enable for tracing requests through the system
- Helpful for debugging and performance optimization

## Estimated Costs

For typical startup usage patterns (< 1000 DAU):
- Cognito: Likely free tier
- API Gateway: ~$10-20/month
- Lambda: Likely within free tier or < $5/month
- DynamoDB: On-demand pricing, likely < $20/month
- S3: Storage costs + data transfer, ~$10-30/month depending on audio file size and quantity
- CloudFront (if used): ~$10-20/month

Total estimated monthly cost: $50-100/month for v1 