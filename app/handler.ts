import { APIGatewayProxyEvent } from "aws-lambda/trigger/api-gateway-proxy";
import axios from "axios";
const pg = require('pg');

const client = new pg.Client({
	user: process.env.USER,
	host: process.env.HOST,
	database: process.env.DATABASE,
	password: process.env.PASSWORD,
	port: process.env.PORT,
});


// Define the AWS Lambda handler function
export const handler = async (event: APIGatewayProxyEvent) => {
	let response: ResponseInterface;

	try {
		if (hasText(event.body)) {
			throw new Error("Message body is not present");
		}
		const queueMessage: IQueueMessage = parseJSON(event.body as string);
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
		const objBusinessCentralDetails = await fetchFromTable('Connections', connectionId, organizationId)
		
		if (objBusinessCentralDetails) {
			// Parse the token details from the database
			const { access_token, refresh_token, expires_on, companyData } = JSON.parse(
				objBusinessCentralDetails.tokenDetails
			);
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
					const objTokenResponse = await axios.post(url, data, {
						headers: {
							'Content-Type': 'application/x-www-form-urlencoded',
						},
					},);

					// Create a new businessCentralTokenDetails object with the refreshed token
					const businessCentralTokenDetails: businessCentralTokenInterface = {
						access_token: objTokenResponse?.data?.access_token,
						refresh_token: objTokenResponse?.data?.refresh_token,
						expires_on: objTokenResponse?.data?.expires_on,
						companyData: companyData
					};

					const updatedTokenDetails = JSON.stringify(businessCentralTokenDetails)

					const res = await updateTokenDetails('Connections', connectionId, organizationId,updatedTokenDetails)
					response = {
						statusCode: 200,
						body: JSON.stringify({
							message: "Access token updated successfully",
							businessCentralAccessToken: businessCentralTokenDetails?.access_token,
							businessCentralCompanyId: companyData?.value[0]?.id,
						}),
					};
				} catch (error: any) {
					response = {
						statusCode: error?.response?.status,
						body: JSON.stringify({
							status: error?.response?.status,
							message: error.message,
						}),
					};
				}
			} else {
				// The access token is still valid, use it
				response = {
					statusCode: 200,
					body: JSON.stringify({
						message: "Access token get successfully",
						businessCentralAccessToken: access_token,
						businessCentralCompanyId: companyData?.value[0]?.id,
					}),
				};
			}
		} else {
			response = {
				statusCode: 400,
				body: JSON.stringify({
					message: "business central credentials details not found",
				}),
			};
		}
	} catch (error: any) {
		response = {
			statusCode: 400,
			body: JSON.stringify({
				message: error.message,
			}),
		};
	}
	return response;
};

// Define the businessCentralTokenInterface for token details
interface businessCentralTokenInterface {
	access_token?: string;
	refresh_token?: string;
	expires_on?: number;
	companyData?: string
}

interface ResponseInterface {
	statusCode: number;
	body: any;
}

interface IQueueMessage {
	connectionId: number;
	organizationId: string;
}

// Function to check if a token has expired
const isTokenExpired = (expiryUnixTimestamp: number) => {
	const currentDate = Math.floor(new Date().getTime() / 1000);;
	const expirationDate = expiryUnixTimestamp;
	return currentDate >= expirationDate;
};

function hasText(value: string | null | undefined): boolean {
	return value == null || value == undefined || value.trim().length === 0;
}

function parseJSON(jsonString: string) {
	try {
		const parsedObject = JSON.parse(jsonString);
		return parsedObject;
	} catch (error) {
		throw new Error("Fail to parse to json object");
	}
}
function validateQueueMessage(queueMessage: IQueueMessage): void {
	const missingFields: any = [];

	if (!queueMessage.organizationId) {
		missingFields.push("Organization Id");
	}
	if (!queueMessage.connectionId) {
		missingFields.push("Connection Id");
	}
	if (missingFields.length > 0) {
		throw new Error(
			`${missingFields.join(" and ")} ${missingFields.length > 1 ? "are" : "is"
			} missing`
		);
	}
}

async function fetchFromTable(tableName: string, connectionId: number, organizationId: string) {
    try {
        // Connect to the database
        await client.connect();

        const query = `SELECT * FROM "${tableName}" WHERE id = $1 AND "organizationId" = $2`;
        const values = [connectionId, organizationId];
        const result = await client.query(query, values);

        // Process the result here
        return result.rows[0];
    } catch (error) {
        console.error('Error:', error);
    } 
}

async function updateTokenDetails(tableName: string, connectionId: number, organizationId: string, newTokenDetails: string) {
  
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
        } else {
            console.log('No rows updated.');
            return null;
        }
    } catch (error) {
        console.error('Error:', error);
        return null;
    }finally {
        // Ensure the client is closed after use
        await client.end();
    }
}
