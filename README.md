## Epic Backend App

Description

The following repository outlines a basic backend app that connects to Epic's Sandbox data and extract all lab results for each patient and compares each value with a corresponding reference range to determine if the results are normal or abnormal. The app then displays this in an email and autosends them every 24 hours to a designated email address.

Features

 OAuth2 Authentication: FHIR with Epic

 Lab Extraction: Bulk FHIR Request

 Email: Ethereal demo email with CRON to schedule Emails
  

Tech Stack

    Backend: Svelte, TypeScript, Javascript, FHIR
