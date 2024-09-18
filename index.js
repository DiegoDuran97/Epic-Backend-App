import fs from 'fs'
import jose from 'node-jose'
import { randomUUID } from 'crypto'
import axios from 'axios'
import hyperquest from 'hyperquest'
import ndjson from 'ndjson'
import nodemailer from 'nodemailer'
import schedule from 'node-schedule'

const CLIENT_ID = "34f466bf-18f6-4e15-92d3-e9c3a3909ad5"
const tokenEndpoint = "https://fhir.epic.com/interconnect-fhir-oauth/oauth2/token"
const fhirBaseUrl = "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4"
const groupId = 'e3iabhmS8rsueyz7vaimuiaSmfGvi.QwjVXJANlPOgR83'

const createJWT = async (payload) => {
    const ks = fs.readFileSync('keys.json')
    const keyStore = await jose.JWK.asKeyStore(ks.toString())
    const key = keyStore.get({ use: 'sig' })
    return jose.JWS.createSign({ compact: true, fields: { "typ": "jwt" } }, key)
        .update(JSON.stringify(payload))
        .final()
}

const generateExpiry = (minutes) => {
    return Math.round((new Date().getTime() + minutes * 60 * 1000) / 1000)
}

const makeTokenRequest = async () => {
    const jwt = await createJWT({
        "iss": CLIENT_ID,
        "sub": CLIENT_ID,
        "aud": tokenEndpoint,
        "jti": randomUUID(),
        "exp": generateExpiry(4),
    })

    const formParams = new URLSearchParams()
    formParams.set('grant_type', 'client_credentials')
    formParams.set('client_assertion_type', 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer')
    formParams.set('client_assertion', jwt)

    const tokenResponse = await axios.post(tokenEndpoint, formParams, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        }
    })
    return tokenResponse.data
}

const kickOffBulkDataExport = async (accessToken) => {
    const bulkKickoffResponse = await axios.get(`${fhirBaseUrl}/Group/${groupId}/$export`, {
        params: {
            _type: "patient,observation",
            typeFilter: "observation?category=labratory"
        },
        headers: {
            Accept: 'application/fhir+json',
            Authorization: `bearer ${accessToken}`,
            Prefer: 'respond-async'
        }
    })

    return bulkKickoffResponse.headers.get('Content-Location')
}

const pullAndWaitForExport = async (url, accessToken, secsToWait = 10) => {
    try {
        const response = await axios.get(url, {
            headers: {
                Authorization: `bearer ${accessToken}`
            }
        })
        const progress = response.headers.get("X-Progress")
        const status = response.status
        const data = response.data
        console.log({ url, status, progress, data })
        if (response.status == 200) {
            return response.data
        }
    } catch (e) {
        console.log(`Error trying to get Bulk Request. Retrying...`);
    }
    console.log(`[${new Date().toISOString()}] waiting ${secsToWait} seconds`)
    await new Promise(resolve => setTimeout(resolve, secsToWait * 1000))
    return await pullAndWaitForExport(url, accessToken, secsToWait)
}

const processBulkResponse = async (bundleResponse, accessToken, type, fn) => {
    const filteredOutputs = bundleResponse.output?.filter((output) => output.type)
    const promises = filteredOutputs?.map((output) => {
        const url = output.url
        return new Promise((resolve) => {
            const stream = hyperquest(url, {
                headers: {
                    Authorization: `bearer ${accessToken}`
                }
            });
            stream.pipe(ndjson.parse()).on('data', fn)
            stream.on('error', resolve)
            stream.on('end', resolve)
        })
    })
    return await Promise.all(promises)
}

const checkObservationNormal = (resource) => {
    const value = resource?.valueQuantity?.value
    if (!resource?.referenceRange) {
        return { isNormal: null, reason: "No Reference Range Found" }
    }
    const referenceRangeLow = resource?.referenceRange?.[0]?.low?.value
    const referenceRangeHigh = resource?.referenceRange?.[0]?.high?.value
    if (!value || !referenceRangeLow || !referenceRangeHigh) {
        return { isNormal: false, reason: "Incomplete Data" }
    }
    if (value >= referenceRangeLow && value <= referenceRangeHigh) {
        return { isNormal: true, reason: "Within Reference Range" }
    } else {
        return { isNormal: false, reason: "Outside Reference Range" }
    }
}

const sendEmail = async (body) => {
    const transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email',
        port: 587,
        auth: {
            user: 'iva66@ethereal.email',
            pass: 'CKMSVM6G75j7SwUHwZ'
        }
    });
    return await transporter.sendMail(body)
}

const main = async () => {
    console.log("Running main function")
    const tokenResponse = await makeTokenRequest()
    const accessToken = tokenResponse.access_token
    const contentLocation = await kickOffBulkDataExport(accessToken)
    const bulkDataResponse = await pullAndWaitForExport(contentLocation, accessToken, 30)

    const patients = {}
    await processBulkResponse(bulkDataResponse, accessToken, 'Patent', (resource) => {
        patients[`Patient/${resource.id}`] = resource
    })

    let message = `Results of Lab Tests in Sandbox (Date: ${new Date().toISOString()})\n\n`

    let abnormalObservations = `======================\nAbnormal Observations:\n======================\n`
    let normalObservations = `======================\nNormal Observations:\n======================\n`
    
    await processBulkResponse(bulkDataResponse, accessToken, 'Observation', (resource) => {
        const { isNormal, reason } = checkObservationNormal(resource)
        if (isNormal === null) {
            return
        }
        if (resource.subject && resource.subject.reference) {
            const patient = patients[resource.subject.reference]
            if (patient) {
                const observationDetails = `Observation: ${resource.code.text}\nValue: ${resource?.valueQuantity?.value}\nReason: ${reason}\nPatient Name: ${patient?.name?.[0]?.text || 'Unknown'}, Patient MRN: ${patient?.id || 'Unknown'}\n\n`
                if (isNormal) {
                    normalObservations += observationDetails
                } else {
                    abnormalObservations += observationDetails
                }
            } else {
                console.log(`Patient not found for reference ${resource.subject.reference}`);
            }
        } else {
            console.log("Subject or reference missing in resource.");
        }
    })

    if (abnormalObservations === `======================\nAbnormal Observations:\n======================\n`) {
        abnormalObservations += "No abnormal observations found.\n\n"
    }

    if (normalObservations === `======================\nNormal Observations:\n======================\n`) {
        normalObservations += "No normal observations found.\n\n"
    }

    message += abnormalObservations + normalObservations

    console.log(message)

    const emailAck = await sendEmail({
        from: '"Diego Duran" <diego.duran@torontomu.ca>', // sender address
        to: "iva66@ethereal.email", // list of receivers
        subject: `Lab Reports on ${new Date().toDateString()}`, // Subject line
        text: message, // html body
    })
    console.log("Email Sent", emailAck)
}

schedule.scheduleJob('0 0 * * *', main)
