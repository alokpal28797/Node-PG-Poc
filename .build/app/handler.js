"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const axios_1 = require("axios");
const pg = require('pg');
const client = new pg.Client({
    user: process.env.USER,
    host: process.env.HOST,
    database: process.env.DATABASE,
    password: process.env.PASSWORD,
    port: process.env.PORT,
});
// Define the AWS Lambda handler function
const handler = async (event) => {
    var _a, _b, _c, _d, _e, _f, _g;
    let response;
    try {
        if (hasText(event.body)) {
            throw new Error("Message body is not present");
        }
        const queueMessage = parseJSON(event.body);
        validateQueueMessage(queueMessage);
        const connectionId = queueMessage.connectionId;
        const organizationId = queueMessage.organizationId;
        // Check if the 'organizationId' field is present in the request data
        if (!organizationId) {
            throw new Error("organizationId is not present");
        }
        // Check if the 'connectionId' field is present in the request data
        if (!connectionId) {
            throw new Error("connectionId is not present");
        }
        // Retrieve BusinessCentral credentials from the database based on the 'companyId'
        const objBusinessCentralDetails = await fetchFromTable('Connections', connectionId, organizationId);
        if (objBusinessCentralDetails) {
            // Parse the token details from the database
            const { access_token, refresh_token, expires_on, companyData } = JSON.parse(objBusinessCentralDetails.tokenDetails);
            // Check if access token and refresh token are present
            if (!refresh_token || !access_token) {
                throw new Error("Refresh token or accessToken are not present");
            }
            // Check if the access token has expired
            if (isTokenExpired(Number(expires_on))) {
                const url = `${process.env.BUSINESS_CENTRAL_TOKEN_RETRIVE_URL}`;
                let data = {
                    grant_type: "refresh_token",
                    client_id: `${process.env.CLIENT_ID}`,
                    refresh_token: refresh_token,
                    client_secret: `${process.env.CLIENT_SECRET}`,
                };
                try {
                    // Send a POST request to obtain a new access token
                    const objTokenResponse = await axios_1.default.post(url, data, {
                        headers: {
                            'Content-Type': 'application/x-www-form-urlencoded',
                        },
                    });
                    // Create a new businessCentralTokenDetails object with the refreshed token
                    const businessCentralTokenDetails = {
                        access_token: (_a = objTokenResponse === null || objTokenResponse === void 0 ? void 0 : objTokenResponse.data) === null || _a === void 0 ? void 0 : _a.access_token,
                        refresh_token: (_b = objTokenResponse === null || objTokenResponse === void 0 ? void 0 : objTokenResponse.data) === null || _b === void 0 ? void 0 : _b.refresh_token,
                        expires_on: (_c = objTokenResponse === null || objTokenResponse === void 0 ? void 0 : objTokenResponse.data) === null || _c === void 0 ? void 0 : _c.expires_on,
                        companyData: companyData
                    };
                    const updatedTokenDetails = JSON.stringify(businessCentralTokenDetails);
                    const res = await updateTokenDetails('Connections', connectionId, organizationId, updatedTokenDetails);
                    response = {
                        statusCode: 200,
                        body: JSON.stringify({
                            message: "Access token updated successfully",
                            businessCentralAccessToken: businessCentralTokenDetails === null || businessCentralTokenDetails === void 0 ? void 0 : businessCentralTokenDetails.access_token,
                            businessCentralCompanyId: (_d = companyData === null || companyData === void 0 ? void 0 : companyData.value[0]) === null || _d === void 0 ? void 0 : _d.id,
                        }),
                    };
                }
                catch (error) {
                    response = {
                        statusCode: (_e = error === null || error === void 0 ? void 0 : error.response) === null || _e === void 0 ? void 0 : _e.status,
                        body: JSON.stringify({
                            status: (_f = error === null || error === void 0 ? void 0 : error.response) === null || _f === void 0 ? void 0 : _f.status,
                            message: error.message,
                        }),
                    };
                }
            }
            else {
                // The access token is still valid, use it
                response = {
                    statusCode: 200,
                    body: JSON.stringify({
                        message: "Access token get successfully",
                        businessCentralAccessToken: access_token,
                        businessCentralCompanyId: (_g = companyData === null || companyData === void 0 ? void 0 : companyData.value[0]) === null || _g === void 0 ? void 0 : _g.id,
                    }),
                };
            }
        }
        else {
            response = {
                statusCode: 400,
                body: JSON.stringify({
                    message: "business central credentials details not found",
                }),
            };
        }
    }
    catch (error) {
        response = {
            statusCode: 400,
            body: JSON.stringify({
                message: error.message,
            }),
        };
    }
    return response;
};
exports.handler = handler;
// Function to check if a token has expired
const isTokenExpired = (expiryUnixTimestamp) => {
    const currentDate = Math.floor(new Date().getTime() / 1000);
    ;
    const expirationDate = expiryUnixTimestamp;
    return currentDate >= expirationDate;
};
function hasText(value) {
    return value == null || value == undefined || value.trim().length === 0;
}
function parseJSON(jsonString) {
    try {
        const parsedObject = JSON.parse(jsonString);
        return parsedObject;
    }
    catch (error) {
        throw new Error("Fail to parse to json object");
    }
}
function validateQueueMessage(queueMessage) {
    const missingFields = [];
    if (!queueMessage.organizationId) {
        missingFields.push("Organization Id");
    }
    if (!queueMessage.connectionId) {
        missingFields.push("Connection Id");
    }
    if (missingFields.length > 0) {
        throw new Error(`${missingFields.join(" and ")} ${missingFields.length > 1 ? "are" : "is"} missing`);
    }
}
async function fetchFromTable(tableName, connectionId, organizationId) {
    try {
        // Connect to the database
        await client.connect();
        const query = `SELECT * FROM "${tableName}" WHERE id = $1 AND "organizationId" = $2`;
        const values = [connectionId, organizationId];
        const result = await client.query(query, values);
        // Process the result here
        return result.rows[0];
    }
    catch (error) {
        console.error('Error:', error);
    }
}
async function updateTokenDetails(tableName, connectionId, organizationId, newTokenDetails) {
    try {
        // Update query
        const updateQuery = `UPDATE "${tableName}" SET "tokenDetails" = $1 WHERE id = $2 AND "organizationId" = $3 RETURNING *`;
        const updateValues = [newTokenDetails, connectionId, organizationId];
        // Execute the update query
        const updateResult = await client.query(updateQuery, updateValues);
        if (updateResult.rowCount === 1) {
            const updatedRow = updateResult.rows[0];
            console.log('Token details updated successfully:', updatedRow);
            return updatedRow; // Return the updated row
        }
        else {
            console.log('No rows updated.');
            return null;
        }
    }
    catch (error) {
        console.error('Error:', error);
        return null;
    }
    finally {
        // Ensure the client is closed after use
        await client.end();
    }
}
